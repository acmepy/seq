import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, Model, Op, Seq, MapAdapter } from '../src/index.js';
import { createTestContext, cleanupTestContext, testAdapterName, testTable } from './shared/test-context.js';

const contexts = [];
afterEach(async () => {
  while (contexts.length) await cleanupTestContext(contexts.pop());
});

async function setup(compositeMaster = true, map = false) {
  class Order extends Model {}
  class Line extends Model {}
  class Profile extends Model {}
  const tenant = compositeMaster ? { tenant: { type: DataTypes.INTEGER, primaryKey: true, field: 'tenant_key' } } : {};
  const ownerTenant = compositeMaster ? { ownerTenant: { type: DataTypes.INTEGER, primaryKey: true, field: 'owner_tenant' } } : {};
  Order.init({ ...tenant, id: { type: DataTypes.INTEGER, primaryKey: true, field: 'order_key' }, name: { type: DataTypes.STRING(30) } },
    { modelName: 'Order', tableName: testTable('cp_orders'), timestamps: false });
  const ownerAttrs = { ...ownerTenant, order: { type: DataTypes.INTEGER, primaryKey: true, field: 'owner_order' } };
  Line.init({ ...ownerAttrs, line: { type: DataTypes.INTEGER, primaryKey: true, field: 'line_key' }, label: { type: DataTypes.STRING(30), allowNull: false } },
    { modelName: 'Line', tableName: testTable('cp_lines'), timestamps: false });
  Profile.init({ ...ownerAttrs, note: { type: DataTypes.STRING(30) } },
    { modelName: 'Profile', tableName: testTable('cp_profiles'), timestamps: false });
  const fk = compositeMaster ? ['ownerTenant', 'order'] : 'order';
  Order.hasMany(Line, { as: 'lines', foreignKey: fk, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
  Line.belongsTo(Order, { as: 'orderRecord', foreignKey: fk });
  Order.hasOne(Profile, { as: 'profile', foreignKey: fk, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
  Profile.belongsTo(Order, { as: 'orderRecord', foreignKey: fk });
  const models = [Line, Profile, Order]; // sync must order tables by their composite FKs.
  const context = map ? { adapter: new MapAdapter(), models } : await createTestContext({ models });
  if (map) { context.seq = new Seq({ adapter: context.adapter, models, logging: false }); await context.seq.init(); }
  contexts.push(context);
  await context.seq.sync();
  const master = n => compositeMaster ? { tenant: n, id: 7 } : { id: n + 6 };
  const child = n => compositeMaster ? { ownerTenant: n, order: 7 } : { order: n + 6 };
  await Order.bulkCreate([1, 2, 3].map(n => ({ ...master(n), name: `order${n}` })));
  await Line.bulkCreate([{ ...child(1), line: 1, label: 'first' }, { ...child(1), line: 2, label: 'second' }, { ...child(2), line: 1, label: 'other' }]);
  await Profile.create({ ...child(1), note: 'profile' });
  return { ...context, Order, Line, Profile, master, child, compositeMaster };
}

for (const compositeMaster of [false, true]) {
  describe(`Composite PKs: ${compositeMaster ? 'master and detail' : 'detail only'} (${testAdapterName()})`, () => {
    it('finds, saves, updates and destroys a detail using its entire key', async () => {
      const { Line, child } = await setup(compositeMaster);
      const key = { ...child(1), line: 1 };
      const row = await Line.findByPk(key);
      row.setDataValue('label', 'saved');
      await row.save();
      assert.equal((await Line.findByPk(key)).getDataValue('label'), 'saved');
      assert.equal((await Line.findByPk({ ...child(2), line: 1 })).getDataValue('label'), 'other');
      await row.update({ line: 4 });
      assert.equal(await Line.findByPk(key), null);
      assert.equal((await Line.findByPk({ ...child(1), line: 4 })).getDataValue('label'), 'saved');
      await row.destroy();
      assert.equal(await Line.findByPk({ ...child(1), line: 4 }), null);
      assert.equal(await Line.count(), 2);
    });

    it('validates complete keys and enforces composite PK and FK integrity', async () => {
      const { Order, Line, child, master } = await setup(compositeMaster);
      for (const value of [1, [], {}, { line: 1 }, { ...child(1), line: null }, { ...child(1), line: { [Op.in]: [1, 2] } }, { ...child(1), line: 1, extra: 0 }]) {
        await assert.rejects(() => Line.findByPk(value), { code: 'SEQ_MODEL_INVALID_PRIMARY_KEY' });
      }
      await assert.rejects(() => Line.create({ ...child(1), line: 1, label: 'duplicate' }));
      await assert.rejects(() => Line.create({ ...child(1), label: 'missing' }));
      await assert.rejects(() => Line.create({ ...child(99), line: 1, label: 'orphan' }));
      if (compositeMaster) {
        await Order.create({ tenant: 4, id: 99 });
        await assert.rejects(() => Line.create({ ownerTenant: 1, order: 99, line: 1, label: 'cross pair' }));
      }
      const partial = await Line.findOne({ where: { ...child(1), line: 1 }, attributes: ['label'] });
      await assert.rejects(() => partial.save(), { code: 'SEQ_MODEL_INVALID_PRIMARY_KEY' });
      await assert.rejects(() => partial.destroy(), { code: 'SEQ_MODEL_INVALID_PRIMARY_KEY' });
      await assert.rejects(() => Line.upsert({ line: 1, label: 'incomplete' }), { code: 'SEQ_VALIDATION_UPSERT_TARGET' });
      assert.equal((await Order.findOne({ where: master(1) })).getDataValue('name'), 'order1');
      const stale = await Line.findByPk({ ...child(1), line: 1 });
      await Line.destroy({ where: { ...child(1), line: 1 } });
      await stale.update({ line: 2 });
      await stale.update({ label: 'must not replace another row' });
      await stale.destroy();
      assert.equal((await Line.findByPk({ ...child(1), line: 2 })).getDataValue('label'), 'second');
    });

    it('upserts by the whole key and returns rows after a primary-key update', async () => {
      const { Line, child } = await setup(compositeMaster);
      const [updated, created] = await Line.upsert({ ...child(1), line: 1, label: 'upsert' });
      assert.equal(created, false);
      assert.equal(updated.getDataValue('label'), 'upsert');
      const [, inserted] = await Line.upsert({ ...child(1), line: 3, label: 'new' });
      assert.equal(inserted, true);
      const rows = await Line.update({ line: 9 }, { where: { ...child(1), line: 3 } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].getDataValue('line'), 9);
      assert.equal((await Line.findByPk({ ...child(2), line: 1 })).getDataValue('label'), 'other');
    });

    for (const eager of [false, true]) {
      it(`loads both directions and hasOne without merging keys (eager=${eager})`, async () => {
        const { Order, Line, Profile } = await setup(compositeMaster);
        const orders = await Order.findAll({ order: [[compositeMaster ? 'tenant' : 'id', 'ASC']],
          include: [{ model: Line, as: 'lines', eager }, { model: Profile, as: 'profile', eager }] });
        assert.deepEqual(orders.map(row => row.getDataValue('lines').length), [2, 1, 0]);
        assert.equal(orders[0].getDataValue('profile').getDataValue('note'), 'profile');
        assert.equal(orders[1].getDataValue('profile'), null);
        const lines = await Line.findAll({ include: [{ model: Order, as: 'orderRecord', eager }] });
        assert.deepEqual(lines.map(row => row.getDataValue('orderRecord').getDataValue('name')).sort(), ['order1', 'order1', 'order2']);
      });

      it(`supports include filters, projections, nested includes and pagination (eager=${eager})`, async () => {
        const { Order, Line, master, child } = await setup(compositeMaster);
        const rows = await Order.findAll({ attributes: ['name'], order: [[compositeMaster ? 'tenant' : 'id', 'ASC']],
          include: [{ model: Line, as: 'lines', eager, attributes: ['label'], include: [{ model: Order, as: 'orderRecord', eager: !eager, attributes: ['name'] }] }] });
        assert.equal(rows.length, 3);
        assert.deepEqual(Object.keys(rows[0].dataValues).sort(), ['lines', 'name']);
        assert.equal(rows[0].getDataValue('lines')[0].getDataValue('orderRecord').getDataValue('name'), 'order1');
        const filtered = await Order.findAll({ include: [{ model: Line, as: 'lines', where: { label: 'other' }, required: true, eager }] });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].getDataValue('name'), 'order2');
        const filteredPage = await Order.findAll({ limit: 1, order: [[compositeMaster ? 'tenant' : 'id', 'ASC']],
          include: [{ model: Line, as: 'lines', where: { label: 'other' }, required: true, eager }] });
        assert.equal(filteredPage.length, 1);
        assert.equal(filteredPage[0].getDataValue('name'), 'order2');
        const page = await Order.findAll({ limit: 1, offset: 1, order: [[compositeMaster ? 'tenant' : 'id', 'ASC']], include: [{ model: Line, as: 'lines', eager }] });
        assert.equal(page.length, 1);
        assert.equal(page[0].getDataValue('name'), 'order2');
        assert.equal(page[0].getDataValue('lines').length, 1);
        const zero = compositeMaster ? { tenant: 0, id: 0 } : { id: 0 };
        await Order.create(zero);
        assert.ok(await Order.findByPk(compositeMaster ? zero : 0));
        assert.equal((await Line.findByPk({ ...child(1), line: 1 })).getDataValue('label'), 'first');
      });
    }

    it('creates, replaces and upserts nested details with all foreign-key components', async () => {
      const { Order, Line, master, child } = await setup(compositeMaster);
      const include = [{ model: Line, as: 'lines' }];
      const values = { ...master(4), name: 'nested', lines: [{ line: 1, label: 'nested line' }] };
      await Order.create(values, { include });
      assert.ok(await Line.findByPk({ ...child(4), line: 1 }));
      await Order.update({ lines: [{ line: 2, label: 'replace' }] }, { where: master(4), include });
      assert.equal(await Line.findByPk({ ...child(4), line: 1 }), null);
      const [, created] = await Order.upsert({ ...master(4), name: 'upsert', lines: [{ line: 2, label: 'changed' }, { line: 3, label: 'append' }] }, { include });
      assert.equal(created, false);
      assert.equal((await Line.findByPk({ ...child(4), line: 2 })).getDataValue('label'), 'changed');
      assert.equal(await Line.count({ where: child(1) }), 2);
      await assert.rejects(() => Order.update({ lines: [{ line: 4, label: 'x'.repeat(40) }] }, { where: master(4), include }));
      assert.equal(await Line.count({ where: child(4) }), 2);
      await assert.rejects(() => Order.create({ ...master(5), lines: [{ label: 'missing line PK' }] }, { include }));
      assert.equal(await Order.findOne({ where: master(5) }), null);
    });

    it('cascades updates and deletes by the complete key, with transaction rollback', async () => {
      const { seq, Order, Line, Profile, master, child } = await setup(compositeMaster);
      await assert.rejects(() => seq.transaction(async transaction => {
        await Order.update({ id: 99 }, { where: master(1), transaction });
        assert.equal(await Line.count({ where: { ...child(1), order: 99 }, transaction }), 2);
        throw new Error('rollback test');
      }), /rollback test/);
      assert.equal(await Line.count({ where: child(1) }), 2);
      const row = await Order.findOne({ where: master(1), include: [{ model: Line, as: 'lines' }] });
      await row.update({ id: 99 });
      assert.equal(await Line.count({ where: { ...child(1), order: 99 } }), 2);
      assert.equal(await Profile.count({ where: { ...child(1), order: 99 } }), 1);
      assert.equal(await Line.count({ where: child(2) }), 1);
      await row.destroy();
      assert.equal(await Line.count({ where: { ...child(1), order: 99 } }), 0);
      assert.equal(await Profile.count(), 0);
      assert.equal(await Line.count({ where: child(2) }), 1);
    });

    it('registers composite foreign keys when reopening an existing schema', async () => {
      const { seq, adapter, Order, Line } = await setup(compositeMaster);
      adapter.schemas.clear();
      await seq._registerExistingSchemas();
      const schema = adapter.schemas.get(Line._resolvedTableName);
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].columnNames.length, compositeMaster ? 2 : 1);
      const result = await Order.findAll({ include: [{ model: Line, as: 'lines', eager: true }] });
      assert.equal(result.length, 3);
    });
  });
}

it('validates association arity and rejects composite belongsToMany explicitly', async () => {
  class Parent extends Model {}
  Parent.init({ a: { type: DataTypes.INTEGER, primaryKey: true }, b: { type: DataTypes.INTEGER, primaryKey: true } }, { timestamps: false });
  class Child extends Model {}
  Child.init({ a: { type: DataTypes.INTEGER }, b: { type: DataTypes.INTEGER } }, { timestamps: false });
  assert.throws(() => Parent.hasMany(Child, { foreignKey: 'a' }), { code: 'SEQ_ASSOCIATION_INVALID_FOREIGN_KEY' });
  assert.throws(() => Parent.hasOne(Child, { foreignKey: ['a', 'a'] }), { code: 'SEQ_ASSOCIATION_INVALID_FOREIGN_KEY' });
  assert.throws(() => Child.belongsTo(Parent, { foreignKey: ['a', 'missing'] }), { code: 'SEQ_ASSOCIATION_MISSING_FK' });
  assert.throws(() => Parent.belongsToMany(Child, { through: 'junction' }), { code: 'SEQ_ASSOCIATION_COMPOSITE_MANY_TO_MANY_UNSUPPORTED' });
});

for (const restrict of [false, true]) {
  it(`handles string tuples, optional references and ${restrict ? 'RESTRICT' : 'SET NULL'} actions (${testAdapterName()})`, async () => {
    class TextParent extends Model {}
    class OptionalChild extends Model {}
    TextParent.init({ a: { type: DataTypes.STRING(30), primaryKey: true }, b: { type: DataTypes.STRING(30), primaryKey: true }, note: { type: DataTypes.STRING(30) } },
      { modelName: 'TextParent', tableName: testTable('cp_text'), timestamps: false });
    OptionalChild.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, a: { type: DataTypes.STRING(30), field: 'a_ref' }, b: { type: DataTypes.STRING(30), field: 'b_ref' } },
      { modelName: 'OptionalChild', tableName: testTable('cp_optional'), timestamps: false });
    TextParent.hasMany(OptionalChild, { as: 'children', foreignKey: ['a', 'b'], onDelete: restrict ? 'RESTRICT' : 'SET NULL', onUpdate: restrict ? 'RESTRICT' : 'CASCADE' });
    OptionalChild.belongsTo(TextParent, { as: 'parent', foreignKey: ['a', 'b'] });
    const context = await createTestContext({ models: [TextParent, OptionalChild] });
    contexts.push(context);
    await context.seq.sync();
    await TextParent.bulkCreate([{ a: 'a', b: 'b,c', note: 'one' }, { a: 'a,b', b: 'c', note: 'two' }]);
    await OptionalChild.bulkCreate([{ id: 1, a: 'a', b: 'b,c' }, { id: 2, a: 'a,b', b: 'c' }, { id: 3, a: null, b: 'c' }, { id: 4, a: 'a,b', b: null }]);
    for (const eager of [false, true]) {
      const parents = await TextParent.findAll({ order: [['note', 'ASC']], include: [{ model: OptionalChild, as: 'children', eager }] });
      assert.deepEqual(parents.map(row => row.getDataValue('children').map(child => child.getDataValue('id'))), [[1], [2]]);
      const children = await OptionalChild.findAll({ order: [['id', 'ASC']], include: [{ model: TextParent, as: 'parent', eager }] });
      assert.deepEqual(children.map(row => row.getDataValue('parent')?.getDataValue('note') ?? null), ['one', 'two', null, null]);
    }
    if (restrict) {
      await assert.rejects(() => TextParent.update({ a: 'new,a', b: 'new,b' }, { where: { a: 'a', b: 'b,c' } }));
      await assert.rejects(() => TextParent.destroy({ where: { a: 'a', b: 'b,c' } }));
      assert.ok(await TextParent.findByPk({ a: 'a', b: 'b,c' }));
    } else {
      const changed = await TextParent.update({ a: 'new,a', b: 'new,b' }, { where: { a: 'a', b: 'b,c' } });
      assert.equal(changed.length, 1);
      const child = await OptionalChild.findByPk(1);
      assert.equal(child.getDataValue('a'), 'new,a');
      assert.equal(child.getDataValue('b'), 'new,b');
      await TextParent.destroy({ where: { a: 'new,a', b: 'new,b' } });
      const detached = await OptionalChild.findByPk(1);
      assert.equal(detached.getDataValue('a'), null);
      assert.equal(detached.getDataValue('b'), null);
      assert.equal((await OptionalChild.findByPk(2)).getDataValue('a'), 'a,b');
    }
  });
}

if (testAdapterName() === 'sqlite') {
  it('supports composite maestro/detail keys in MapAdapter', async () => {
    const { Order, Line, master } = await setup(true, true);
    const rows = await Order.findAll({ include: [{ model: Line, as: 'lines' }] });
    assert.deepEqual(rows.map(row => row.getDataValue('lines').length), [2, 1, 0]);
    const page = await Order.findAll({ limit: 1, include: [{ model: Line, as: 'lines', required: true, where: { label: 'other' } }] });
    assert.equal(page[0].getDataValue('name'), 'order2');
    await Order.update({ id: 88 }, { where: master(1) });
    assert.equal(await Line.count({ where: { ownerTenant: 1, order: 88 } }), 2);
    await Order.destroy({ where: { tenant: 1, id: 88 } });
    assert.equal(await Line.count(), 1);
  });
}
