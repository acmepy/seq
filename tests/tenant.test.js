import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, Model, Op } from '../src/index.js';
import { generateCacheKey } from '../src/cache/utils.js';
import { createTestContext, cleanupTestContext, testAdapterName, testTable } from './shared/test-context.js';

describe(`Tenant isolation (${testAdapterName()})`, () => {
  let context, request, run, Country, City, Customer, Line, Role, Link, Custom;
  const names = rows => rows.map(row => row.getDataValue('name'));
  const tenantError = code => error => error.code === code;

  beforeEach(async () => {
    request = new AsyncLocalStorage();
    run = (tenantId, execute) => request.run({ tenantId }, execute);
    Country = class Country extends Model {};
    City = class City extends Model {};
    Customer = class Customer extends Model {};
    Line = class Line extends Model {};
    Role = class Role extends Model {};
    Link = class Link extends Model {};
    Custom = class Custom extends Model {};
    const id = { type: DataTypes.INTEGER, primaryKey: true };
    const generated = { ...id, autoIncrement: true };
    const tenant = { type: DataTypes.INTEGER, allowNull: false, field: 'tenant_key' };
    const name = { type: DataTypes.STRING(60), allowNull: false };
    const init = (model, attrs, options = {}) => model.init(attrs, {
      modelName: model.name, tableName: testTable(`tn_${model.name.toLowerCase()}`), timestamps: false, ...options
    });
    init(Country, { id, name }, { tenant: false });
    init(City, { id, name, countryId: { type: DataTypes.INTEGER } });
    init(Customer, { id: generated, tenantId: tenant, name, code: { type: DataTypes.STRING(30), unique: true }, countryId: { type: DataTypes.INTEGER } }, { tenant: true });
    init(Line, { id: generated, tenantId: tenant, name, customerId: { type: DataTypes.INTEGER } }, { tenant: true });
    init(Role, { id, name }, { tenant: false });
    init(Link, { id: generated, tenantId: tenant, customerId: { type: DataTypes.INTEGER }, roleId: { type: DataTypes.INTEGER } }, { tenant: true });
    init(Custom, { id: generated, organization: { type: DataTypes.STRING(40), field: 'org_key' }, name }, { tenant: { attribute: 'organization' } });
    Country.hasMany(City, { as: 'cities', foreignKey: 'countryId' });
    Country.hasMany(Customer, { as: 'customers', foreignKey: 'countryId' });
    Customer.belongsTo(Country, { as: 'country', foreignKey: 'countryId' });
    Customer.hasMany(Line, { as: 'lines', foreignKey: 'customerId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    Line.belongsTo(Customer, { as: 'customer', foreignKey: 'customerId' });
    Link.belongsTo(Customer, { as: 'customer', foreignKey: 'customerId' });
    Link.belongsTo(Role, { as: 'role', foreignKey: 'roleId' });
    Customer.belongsToMany(Role, { through: Link, as: 'roles', foreignKey: 'customerId', otherKey: 'roleId' });
    Role.belongsToMany(Customer, { through: Link, as: 'customers', foreignKey: 'roleId', otherKey: 'customerId' });
    context = await createTestContext({ models: [Country, City, Customer, Line, Role, Link, Custom],
      tenant: { attribute: 'tenantId' }, getContext: () => request.getStore(), cache: { ttl: 60000 } });
    await context.seq.sync();
    await Country.create({ id: 1, name: 'Paraguay' });
    await Country.create({ id: 2, name: 'Argentina' });
    await City.create({ id: 1, countryId: 1, name: 'Asuncion' });
    await Role.create({ id: 1, name: 'reader' });
    await run(1, () => Customer.create({ id: 11, name: 'Ana', code: 'A', countryId: 1 }));
    await run(2, () => Customer.create({ id: 22, name: 'Luis', code: 'B', countryId: 1 }));
  });

  afterEach(async () => { await cleanupTestContext(context); context = null; });

  it('requires context, accepts zero and rejects implicit type conversions', async () => {
    await assert.rejects(() => Customer.findAll(), tenantError('SEQ_TENANT_CONTEXT_MISSING'));
    await assert.rejects(() => run('1', () => Customer.findAll()), tenantError('SEQ_TENANT_CONTEXT_INVALID'));
    await run(0, async () => {
      const row = await Customer.create({ name: 'Zero' });
      assert.equal(row.getDataValue('tenantId'), 0);
      assert.deepEqual(names(await Customer.findAll()), ['Zero']);
    });
    await run('acme', async () => {
      const row = await Custom.create({ name: 'Custom' });
      assert.equal(row.getDataValue('organization'), 'acme');
      assert.equal(await Custom.count(), 1);
    });
    assert.equal(await Country.count(), 2);
  });

  it('scopes find, PK, count, paging and logical filters without changing caller filters', async () => {
    await run(1, async () => {
      const where = { [Op.or]: [{ id: 11 }, { id: 22 }] };
      assert.deepEqual(names(await Customer.findAll({ where, hooks: false })), ['Ana']);
      assert.equal(where[Op.or].length, 2);
      assert.equal(await Customer.findByPk(22), null);
      assert.equal(await Customer.findOne({ where: { id: 22 } }), null);
      assert.equal(await Customer.count(), 1);
      const page = await Customer.findAndCountAll({ limit: 1, order: [['id', 'ASC']], attributes: ['name'], plain: true });
      assert.equal(page.count, 1);
      assert.deepEqual(page.rows, [{ name: 'Ana' }]);
      assert.deepEqual(await Customer.findAll({ where: { tenantId: 2 } }), []);
    });
  });

  it('rejects incomplete configuration and does not take a tenant from attribute defaults', async () => {
    class Invalid extends Model {}
    Invalid.init({ id: { type: DataTypes.INTEGER, primaryKey: true } }, { modelName: 'Invalid', tableName: testTable('tn_invalid'), tenant: true, seq: context.seq });
    assert.throws(() => context.seq.registerModel(Invalid), tenantError('SEQ_TENANT_CONFIG'));
    class NoDefault extends Model {}
    NoDefault.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, tenantId: { type: DataTypes.INTEGER, defaultValue: 99 } },
      { modelName: 'NoDefault', tableName: testTable('tn_nodefault'), tenant: true, seq: context.seq, timestamps: false });
    context.seq.registerModel(NoDefault);
    await context.seq.sync();
    await assert.rejects(() => NoDefault.build({ id: 1 }).save(), tenantError('SEQ_TENANT_CONTEXT_MISSING'));
    await run(1, async () => {
      const row = await NoDefault.build({ id: 1 }).save();
      assert.equal(row.getDataValue('tenantId'), 1);
    });
  });

  it('requires an explicit attribute for tenant:true and supports per-model configuration without global defaults', async () => {
    const configured = context.seq._tenantConfig;
    context.seq._tenantConfig = null;
    try {
      await assert.rejects(() => run(1, () => Customer.findAll()), tenantError('SEQ_TENANT_CONFIG'));
      await run('custom', async () => {
        const row = await Custom.create({ name: 'No global default' });
        assert.equal(row.getDataValue('organization'), 'custom');
      });
    } finally {
      context.seq._tenantConfig = configured;
    }
  });

  it('supports tenant-scoped composite primary and business keys', async () => {
    class Document extends Model {}
    Document.init({ tenantId: { type: DataTypes.INTEGER, primaryKey: true }, id: { type: DataTypes.INTEGER, primaryKey: true },
      code: { type: DataTypes.STRING(30) }, name: { type: DataTypes.STRING(60) } },
    { modelName: 'Document', tableName: testTable('tn_docs'), timestamps: false, tenant: true, seq: context.seq,
      indexes: [{ name: testTable('tn_docs_uk'), columns: ['tenantId', 'code'], unique: true }] });
    context.seq.registerModel(Document);
    await context.seq.sync();
    for (const tenantId of [1, 2]) await run(tenantId, () => Document.create({ id: 1, code: 'same', name: `Tenant${tenantId}` }));
    await run(1, async () => {
      assert.equal(await Document.findByPk({ tenantId: 2, id: 1 }), null);
      const [updated] = await Document.upsert({ id: 1, code: 'same', name: 'Updated' }, { conflictFields: ['tenantId', 'code'] });
      assert.equal(updated.getDataValue('tenantId'), 1);
      await updated.save();
      assert.equal(await Document.destroy({ where: { tenantId: 2, id: 1 } }), 0);
    });
    await run(2, async () => assert.equal((await Document.findByPk({ tenantId: 2, id: 1 })).getDataValue('name'), 'Tenant2'));
  });

  it('protects direct DML calls and validates every bulk record before writing', async () => {
    const dml = context.adapter.dml;
    await run(1, async () => {
      assert.deepEqual(names(await dml.selectAll(Customer)), ['Ana']);
      assert.equal(await dml.count(Customer), 1);
      await assert.rejects(() => dml.bulkInsert(Customer, [{ name: 'valid' }, { name: 'invalid', tenantId: 2 }]), tenantError('SEQ_TENANT_MISMATCH'));
      assert.equal(await Customer.count(), 1);
      assert.deepEqual(await dml.update(Customer, { name: 'bad' }, { where: { id: 22 } }), []);
      assert.equal(await dml.delete(Customer, { where: { id: 22 } }), 0);
      await assert.rejects(() => dml.truncate(Customer), tenantError('SEQ_TENANT_TRUNCATE'));
    });
    await assert.rejects(() => dml.insert(Customer, { name: 'no context' }), tenantError('SEQ_TENANT_CONTEXT_MISSING'));
  });

  it('uses current context for findOrCreate and build().save()', async () => {
    const pending = Customer.build({ name: 'Built' });
    await run(1, async () => {
      await pending.save();
      assert.equal(pending.getDataValue('tenantId'), 1);
      const [found, created] = await Customer.findOrCreate({ code: 'A' }, { name: 'ignored' });
      assert.equal(created, false);
      assert.equal(found.getDataValue('name'), 'Ana');
      const [inserted, isNew] = await Customer.findOrCreate({ code: 'C' }, { name: 'Created' });
      assert.equal(isNew, true);
      assert.equal(inserted.getDataValue('tenantId'), 1);
      await assert.rejects(() => Customer.findOrCreate({ tenantId: 2, code: 'X' }, { name: 'Bad' }), tenantError('SEQ_TENANT_MISMATCH'));
    });
  });

  it('never changes tenant attributes or records belonging to another tenant', async () => {
    let foreign;
    await run(2, async () => { foreign = await Customer.findByPk(22); });
    await run(1, async () => {
      await assert.rejects(() => Customer.create({ name: 'Bad', tenantId: '1' }), tenantError('SEQ_TENANT_MISMATCH'));
      await assert.rejects(() => Customer.update({ tenantId: 2 }, { where: { id: 11 } }), tenantError('SEQ_TENANT_MISMATCH'));
      await assert.rejects(() => foreign.update({ name: 'Bad' }), tenantError('SEQ_TENANT_MISMATCH'));
      await assert.rejects(() => foreign.destroy(), tenantError('SEQ_TENANT_MISMATCH'));
      assert.equal(await Customer.destroy({ where: { id: 22 } }), 0);
      assert.deepEqual(await Customer.update({ name: 'Bad' }, { where: { id: 22 } }), []);
      const own = await Customer.findByPk(11, { attributes: ['id', 'name'] });
      await own.update({ name: 'Changed' });
      assert.equal((await Customer.findByPk(11)).getDataValue('name'), 'Changed');
    });
    await run(2, async () => assert.equal((await Customer.findByPk(22)).getDataValue('name'), 'Luis'));
  });

  it('fails upsert on foreign global PK or UNIQUE conflicts without changing the owner', async () => {
    await run(1, async () => {
      await assert.rejects(() => Customer.upsert({ id: 22, name: 'Bad', code: 'B' }));
      await assert.rejects(() => Customer.upsert({ name: 'Bad', code: 'B' }, { conflictFields: ['code'] }));
      const [updated, created] = await Customer.upsert({ name: 'Updated', code: 'A' }, { conflictFields: ['code'] });
      assert.equal(created, false);
      assert.equal(updated.getDataValue('tenantId'), 1);
    });
    await run(2, async () => assert.equal((await Customer.findByPk(22)).getDataValue('name'), 'Luis'));
  });

  it('cannot bypass isolation using hooks or hooks:false', async () => {
    Customer.addHook('beforeFind', options => { options.where = { id: 22 }; });
    Customer.addHook('beforeUpdate', (values, options) => { options.where = { id: 22 }; });
    await run(1, async () => {
      assert.deepEqual(await Customer.findAll(), []);
      assert.deepEqual(names(await Customer.findAll({ hooks: false })), ['Ana']);
      assert.deepEqual(await Customer.update({ name: 'Bad' }, { where: { id: 11 } }), []);
      assert.equal(await Customer.count({ hooks: false }), 1);
    });
  });

  it('rechecks writes after hooks', async () => {
    Customer.addHook('beforeCreate', values => { values.tenantId = 2; });
    await run(1, async () => {
      await assert.rejects(() => Customer.create({ name: 'Bad' }), tenantError('SEQ_TENANT_MISMATCH'));
      assert.equal(await Customer.count(), 1);
      await Customer.create({ name: 'Hooks disabled' }, { hooks: false });
      assert.equal(await Customer.count(), 2);
    });
  });

  it('captures context throughout one operation even if the provider changes during a hook', async () => {
    let active = 1;
    context.seq._getContext = () => ({ tenantId: active });
    Customer.addHook('beforeFind', async () => { active = 2; await Promise.resolve(); });
    assert.deepEqual(names(await Customer.findAll()), ['Ana']);
    assert.deepEqual(names(await Customer.findAll()), ['Luis']);
  });

  for (const eager of [false, true]) {
    it(`filters protected children under global countries while preserving cities and LEFT JOIN (${eager ? 'eager' : 'lazy'})`, async () => {
      for (const [tenantId, expected] of [[1, 'Ana'], [2, 'Luis']]) await run(tenantId, async () => {
        const rows = await Country.findAll({ order: [['id', 'ASC']], eager, include: [City, { model: Customer, as: 'customers' }] });
        assert.deepEqual(names(rows[0].getDataValue('cities')), ['Asuncion']);
        assert.deepEqual(names(rows[0].getDataValue('customers')), [expected]);
        assert.deepEqual(rows[1].getDataValue('customers'), []);
        const page = await Country.findAndCountAll({ eager, include: [{ model: Customer, as: 'customers', required: true }], limit: 1 });
        assert.equal(page.count, 1);
        assert.equal(page.rows[0].getDataValue('id'), 1);
      });
      await assert.rejects(() => Country.findAll({ eager, include: [Customer] }), tenantError('SEQ_TENANT_CONTEXT_MISSING'));
    });
  }

  it('rejects foreign references on insert, bulk and update', async () => {
    await run(1, async () => {
      await assert.rejects(() => Line.create({ name: 'Bad', customerId: 22 }), tenantError('SEQ_TENANT_REFERENCE'));
      await assert.rejects(() => Line.bulkCreate([{ name: 'Good', customerId: 11 }, { name: 'Bad', customerId: 22 }]), tenantError('SEQ_TENANT_REFERENCE'));
      assert.equal(await Line.count(), 0);
      const line = await Line.create({ name: 'Good', customerId: 11 });
      await assert.rejects(() => line.update({ customerId: 22 }), tenantError('SEQ_TENANT_REFERENCE'));
    });
  });

  it('propagates context into nested writes and rolls back tenant failures', async () => {
    await run(1, async () => {
      const parent = await Customer.create({ name: 'Nested', lines: [{ name: 'One' }] }, { include: [{ model: Line, as: 'lines' }] });
      const child = parent.getDataValue('lines')[0];
      assert.equal(child.getDataValue('tenantId'), 1);
      await assert.rejects(() => Customer.create({ name: 'Rollback', lines: [{ name: 'Bad', tenantId: 2 }] }, { include: [Line] }), tenantError('SEQ_TENANT_MISMATCH'));
      assert.equal(await Customer.count({ where: { name: 'Rollback' } }), 0);
      await Customer.update({ lines: [{ name: 'Replaced' }] }, { where: { id: parent.getDataValue('id') }, include: [Line] });
      assert.deepEqual(names(await Line.findAll()), ['Replaced']);
    });
  });

  it('scopes nested upsert and related deletes and preserves other tenants on cascade', async () => {
    let foreignLine;
    await run(2, async () => { foreignLine = await Line.create({ name: 'Foreign line', customerId: 22 }); });
    await run(1, async () => {
      await Customer.upsert({ id: 11, name: 'Ana', code: 'A', lines: [{ name: 'Owned line' }] }, { include: [Line] });
      const rows = await Customer.findAll({ include: [{ model: Line, include: [{ model: Customer, as: 'customer' }] }] });
      assert.equal(rows[0].getDataValue('lines')[0].getDataValue('customer').getDataValue('tenantId'), 1);
      await assert.rejects(() => Customer.upsert({ id: 11, name: 'Bad', code: 'A', lines: [{ id: foreignLine.getDataValue('id'), name: 'Hijacked' }] }, { include: [Line] }));
      assert.equal((await Customer.findByPk(11)).getDataValue('name'), 'Ana');
      assert.equal(await Line.count(), 1);
      await Customer.destroy({ where: { id: 11 } });
      assert.equal(await Line.count(), 0);
    });
    await run(2, async () => assert.equal((await Line.findByPk(foreignLine.getDataValue('id'))).getDataValue('name'), 'Foreign line'));
  });

  it('scopes many-to-many links and invalidates included cache dependencies', async () => {
    for (const [tenantId, customerId] of [[1, 11], [2, 22]]) await run(tenantId, () => Link.create({ customerId, roleId: 1 }));
    for (const eager of [false, true]) await run(1, async () => {
      const role = await Role.findByPk(1, { eager, include: [{ model: Customer, as: 'customers' }] });
      assert.deepEqual(names(role.getDataValue('customers')), ['Ana']);
      await Customer.update({ name: 'New' }, { where: { id: 11 } });
      const updated = await Role.findByPk(1, { eager, include: [{ model: Customer, as: 'customers' }] });
      assert.deepEqual(names(updated.getDataValue('customers')), ['New']);
      await Customer.update({ name: 'Ana' }, { where: { id: 11 } });
    });
    await run(1, async () => {
      const query = { include: [{ model: Customer, as: 'customers' }] };
      await Role.findByPk(1, query);
      await Link.destroy({ where: { customerId: 11 } });
      assert.deepEqual((await Role.findByPk(1, query)).getDataValue('customers'), []);
      await assert.rejects(() => Link.create({ customerId: 22, roleId: 1 }), tenantError('SEQ_TENANT_REFERENCE'));
    });
  });

  it('scopes automatically generated junction tables', async () => {
    const table = testTable('tn_auto');
    Customer.belongsToMany(Role, { through: table, as: 'autoRoles', foreignKey: 'customerId', otherKey: 'roleId' });
    await context.seq.sync();
    class AutoLink extends Model {}
    AutoLink.init({ tenantId: { type: DataTypes.INTEGER, field: 'tenant_key' }, customerId: { type: DataTypes.INTEGER }, roleId: { type: DataTypes.INTEGER } },
      { modelName: 'AutoLink', tableName: table, seq: context.seq, timestamps: false, tenant: true });
    context.seq.registerModel(AutoLink);
    await run(1, async () => {
      await AutoLink.create({ customerId: 11, roleId: 1 });
      for (const eager of [false, true]) {
        const result = await Customer.findByPk(11, { eager, include: [{ model: Role, as: 'autoRoles', required: true }] });
        assert.deepEqual(names(result.getDataValue('autoRoles')), ['reader']);
      }
      await AutoLink.destroy({ where: { customerId: 11 } });
      assert.deepEqual((await Customer.findByPk(11, { include: [{ model: Role, as: 'autoRoles' }] })).getDataValue('autoRoles'), []);
    });
    await run(2, async () => {
      await assert.rejects(() => AutoLink.create({ customerId: 11, roleId: 1 }), tenantError('SEQ_TENANT_REFERENCE'));
    });
  });

  it('partitions every cache key by typed context and includes symbol filters', async () => {
    const options = { where: { [Op.and]: [{ name: { [Op.like]: 'A%' } }] } };
    assert.notEqual(generateCacheKey('Country', 'findAll', {}, 1), generateCacheKey('Country', 'findAll', {}, '1'));
    assert.notEqual(generateCacheKey('Country', 'findAll', {}, 0), generateCacheKey('Country', 'findAll', {}));
    assert.notEqual(generateCacheKey('Customer', 'findAll', options, 1), generateCacheKey('Customer', 'findAll', { where: { [Op.and]: [{ name: { [Op.like]: 'B%' } }] } }, 1));
    for (const tenantId of [1, 2]) await run(tenantId, async () => {
      assert.deepEqual(names(await Customer.findAll()), [tenantId === 1 ? 'Ana' : 'Luis']);
      await Country.findAll();
    });
    const globalKeys = [...context.seq.cache.adapter._map.keys()].filter(key => key.startsWith('seq:Country:findAll:'));
    assert.equal(globalKeys.length, 2);
    await Country.update({ name: 'PY' }, { where: { id: 1 } });
    for (const tenantId of [1, 2]) await run(tenantId, async () => assert.equal((await Country.findByPk(1)).getDataValue('name'), 'PY'));
  });

  it('keeps concurrent request contexts separate', async () => {
    const results = await Promise.all([1, 2].map(tenantId => run(tenantId, async () => {
      await Promise.resolve();
      return names(await Customer.findAll());
    })));
    assert.deepEqual(results, [['Ana'], ['Luis']]);
  });

  it('isolates tenant invalidations, including direct DML writes', async () => {
    for (const tenantId of [1, 2]) await run(tenantId, () => Customer.findAll());
    const secondKey = generateCacheKey('Customer', 'findAll', { where: { tenantId: 2 } }, 2);
    assert.equal((await context.seq.cache.adapter.get(secondKey)).hit, true);
    await run(1, () => context.adapter.dml.insert(Customer, { name: 'Direct' }));
    assert.equal((await context.seq.cache.adapter.get(secondKey)).hit, true);
    await run(1, async () => assert.deepEqual(names(await Customer.findAll()), ['Ana', 'Direct']));
  });

  it('does not expose locally modified cached instances', async () => {
    await run(1, async () => {
      const cached = await Customer.findByPk(11);
      cached.setDataValue('name', 'local only');
      assert.equal((await Customer.findByPk(11)).getDataValue('name'), 'Ana');
    });
  });

  it('rejects a transaction reused by a separate tenant context', async () => {
    const transaction = await run(1, () => context.adapter.tcl.begin());
    try {
      await run(2, () => assert.rejects(() => context.adapter.dml.count(Customer, { transaction }), tenantError('SEQ_TENANT_TRANSACTION_MISMATCH')));
      await run(2, () => assert.rejects(() => context.adapter.tcl.commit(transaction), tenantError('SEQ_TENANT_TRANSACTION_MISMATCH')));
    } finally {
      await run(1, () => context.adapter.tcl.rollback(transaction));
    }
  });

  it('binds transactions to context, invalidates after commit and preserves cache on rollback', async () => {
    await run(1, async () => {
      await Customer.findAll();
      await context.seq.transaction(async transaction => {
        await Customer.create({ name: 'Committed' }, { transaction });
        assert.equal(await Customer.count({ transaction }), 2);
      });
      assert.equal(await Customer.count(), 2);
      await assert.rejects(() => context.seq.transaction(async transaction => {
        await Customer.create({ name: 'Rollback' }, { transaction });
        throw new Error('rollback');
      }), /rollback/);
      assert.equal(await Customer.count(), 2);
      const transaction = await context.adapter.tcl.begin();
      try {
        await run(2, () => assert.rejects(() => Customer.count({ transaction }), tenantError('SEQ_TENANT_TRANSACTION_MISMATCH')));
      } finally {
        await context.adapter.tcl.rollback(transaction);
      }
    });
  });
});
