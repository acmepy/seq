import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, MapAdapter, Model, Op, Oracle11Adapter, Seq, SQLiteAdapter } from '../src/index.js';
import { cleanupTestContext, createTestContext, testAdapterName, testTable } from './shared/test-context.js';

const open = [];
afterEach(async () => {
  while (open.length) await cleanupTestContext(open.pop());
});

async function setup(adapter, attributes, options = {}) {
  class TestModel extends Model {}
  TestModel.init(attributes, { modelName: options.modelName || 'TestModel', tableName: options.tableName || testTable('test_models'), timestamps: false });
  const seq = new Seq({ adapter, models: [TestModel], logging: false });
  await seq.init();
  await seq.sync();
  open.push({ seq, adapter, models: [TestModel] });
  return { seq, ModelClass: TestModel };
}

async function setupSql(attributes, options = {}) {
  class TestModel extends Model {}
  TestModel.init(attributes, { modelName: options.modelName || 'TestModel', tableName: options.tableName || testTable('test_models'), timestamps: false });
  const context = await createTestContext({ models: [TestModel], logging: false, adapterOptions: options.adapterOptions || {} });
  await context.seq.sync();
  open.push(context);
  return { seq: context.seq, ModelClass: TestModel };
}

describe('SQL and validation hardening', () => {
  it('rejects injected and unknown order clauses', async () => {
    const { ModelClass } = await setupSql({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING }
    });
    await assert.rejects(() => ModelClass.findAll({ order: [['id', 'DESC LIMIT 1']] }), error => error.code === 'SEQ_VALIDATION_ORDER');
    await assert.rejects(() => ModelClass.findAll({ order: [['missing', 'ASC']] }), error => error.code === 'SEQ_VALIDATION_ORDER');
  });

  it('handles null and empty IN predicates consistently', async () => {
    const cases = [
      ['sql', () => setupSql({
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        value: { type: DataTypes.STRING, allowNull: true }
      }, { tableName: testTable('nulls') })]
    ];
    if (testAdapterName() === 'sqlite') {
      cases.push(['map', () => setup(new MapAdapter(), {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        value: { type: DataTypes.STRING, allowNull: true }
      }, { tableName: `nulls_${open.length}` })]);
    }

    for (const [name, factory] of cases) {
      const { ModelClass } = await factory();
      await ModelClass.create({ value: null });
      assert.equal(await ModelClass.count({ where: { value: null } }), 1);
      assert.equal(await ModelClass.count({ where: { id: { [Op.in]: [] } } }), 0);
      assert.equal(await ModelClass.count({ where: { id: { [Op.notIn]: [] } } }), 1, name);
    }
  });

  it('quotes identifiers and string defaults safely', async () => {
    const { ModelClass } = await setupSql({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      odd: { type: DataTypes.STRING, field: 'odd"column', defaultValue: "O'Brien" }
    });
    const row = await ModelClass.create({});
    assert.equal(row.getDataValue('odd'), "O'Brien");
  });

  it('validates SQL updates and returns rows when the where field changes', async () => {
    const { ModelClass } = await setupSql({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      code: { type: DataTypes.STRING(3), allowNull: false }
    });
    await ModelClass.create({ code: 'old' });
    await assert.rejects(() => ModelClass.update({ code: 'too-long' }, { where: { code: 'old' } }), error => error.code === 'SEQ_VALIDATION_TYPE');
    const updated = await ModelClass.update({ code: 'new' }, { where: { code: 'old' } });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].getDataValue('code'), 'new');
  });

  it('supports DEFAULT VALUES inserts', async () => {
    const { ModelClass } = await setupSql({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
    });
    assert.equal((await ModelClass.create({})).getDataValue('id'), 1);
  });
});

describe('Map atomicity', () => {
  it('rolls back failed updates and bulk inserts', async () => {
    if (testAdapterName() !== 'sqlite') return;

    const { ModelClass } = await setup(new MapAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      email: { type: DataTypes.STRING, unique: true }
    });
    await ModelClass.bulkCreate([{ email: 'a' }, { email: 'b' }]);
    await assert.rejects(() => ModelClass.update({ email: 'a' }, { where: { email: 'b' } }));
    assert.deepEqual((await ModelClass.findAll({ order: [['id', 'ASC']] })).map(row => row.getDataValue('email')), ['a', 'b']);
    await assert.rejects(() => ModelClass.bulkCreate([{ email: 'c' }, { email: 'c' }]));
    assert.equal(await ModelClass.count(), 2);
  });

  it('reindexes primary keys atomically', async () => {
    if (testAdapterName() !== 'sqlite') return;

    const { ModelClass } = await setup(new MapAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      name: { type: DataTypes.STRING }
    });
    await ModelClass.create({ id: 1, name: 'one' });
    await ModelClass.update({ id: 2 }, { where: { id: 1 } });
    assert.equal(await ModelClass.findByPk(1), null);
    assert.equal((await ModelClass.findByPk(2)).getDataValue('name'), 'one');
  });
});

describe('Schema introspection', () => {
  it('introspects Oracle definitions against physical metadata', async () => {
    const adapter = new Oracle11Adapter();
    adapter.ddl._executeQueryAll = async sql => {
      if (sql.includes('USER_TAB_COLUMNS')) return [{ COLUMN_NAME: 'ID' }, { COLUMN_NAME: 'NAME' }, { COLUMN_NAME: 'CREATED_AT' }];
      if (sql.includes("CONSTRAINT_TYPE = 'U'")) return [{ CONSTRAINT_NAME: 'UQ_USERS_NAME' }];
      if (sql.includes('USER_INDEXES')) return [{ INDEX_NAME: 'IDX_USERS_NAME' }];
      if (sql.includes("CONSTRAINT_TYPE = 'R'")) return [{ CONSTRAINT_NAME: 'FK_USERS_OWNER' }];
      throw new Error(`Unexpected query: ${sql}`);
    };

    const definition = {
      tableName: 'USERS',
      timestamps: true,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      columns: {
        id: { field: 'ID' },
        name: { field: 'NAME' },
        missing: { field: 'MISSING' },
        createdAt: { field: 'CREATED_AT' },
        updatedAt: { field: 'UPDATED_AT' }
      },
      attrToColumn: { id: 'ID', name: 'NAME', missing: 'MISSING', createdAt: 'CREATED_AT', updatedAt: 'UPDATED_AT' },
      columnToAttr: { ID: 'id', NAME: 'name', MISSING: 'missing', CREATED_AT: 'createdAt', UPDATED_AT: 'updatedAt' },
      uniqueConstraints: [{ constraintName: 'UQ_USERS_NAME', columns: ['NAME'] }, { constraintName: 'UQ_USERS_MISSING', columns: ['MISSING'] }],
      indexes: [{ name: 'IDX_USERS_NAME', columns: ['NAME'] }, { name: 'IDX_USERS_MISSING', columns: ['MISSING'] }],
      foreignKeys: [{ constraintName: 'FK_USERS_OWNER' }, { constraintName: 'FK_USERS_MISSING' }]
    };

    const schema = await adapter.ddl.introspectDefinition(definition);
    assert.deepEqual(Object.keys(schema.columns), ['id', 'name', 'createdAt']);
    assert.deepEqual(schema.attrToColumn, { id: 'ID', name: 'NAME', createdAt: 'CREATED_AT' });
    assert.deepEqual(schema.columnToAttr, { ID: 'id', NAME: 'name', CREATED_AT: 'createdAt' });
    assert.deepEqual(schema.uniqueConstraints.map(item => item.constraintName), ['UQ_USERS_NAME']);
    assert.deepEqual(schema.indexes.map(item => item.name), ['IDX_USERS_NAME']);
    assert.deepEqual(schema.foreignKeys.map(item => item.constraintName), ['FK_USERS_OWNER']);
  });

  it('adds a physically missing column after reopening', async () => {
    if (testAdapterName() !== 'sqlite') return;

    class User extends Model {}
    User.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
      added: { type: DataTypes.STRING }
    }, { modelName: 'User', tableName: 'users' });
    const adapter = new SQLiteAdapter();
    await adapter.connect();
    adapter._db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const introspectDefinition = adapter.ddl.introspectDefinition.bind(adapter.ddl);
    adapter.ddl.introspectDefinition = async definition => {
      await Promise.resolve();
      return introspectDefinition(definition);
    };
    const seq = new Seq({ adapter, models: [User], logging: false });
    await seq.init();
    open.push({ seq, adapter, models: [User] });
    assert.ok(adapter.schemas.has('users'));
    const result = await seq.sync({ alter: true });
    assert.deepEqual(result.altered, ['users']);
    const columns = adapter._db.pragma('table_info(users)').map(column => column.name);
    assert.ok(columns.includes('added'));
    assert.ok(columns.includes('created_at'));
    assert.ok(columns.includes('updated_at'));
  });
});

describe('Includes and data types', () => {
  it('does not truncate eager child collections when paginating parents', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } }, { tableName: testTable('users'), timestamps: false });
    Task.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, userId: { type: DataTypes.INTEGER }, title: { type: DataTypes.STRING } }, { tableName: testTable('tasks'), timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const context = await createTestContext({ models: [User, Task], logging: false });
    const seq = context.seq;
    await seq.sync(); open.push(context);
    await User.create({});
    await Task.bulkCreate([{ userId: 1, title: 'a' }, { userId: 1, title: 'b' }, { userId: 1, title: 'c' }]);
    const rows = await User.findAll({ include: [{ model: Task, eager: true, attributes: ['title'] }], limit: 1 });
    assert.deepEqual(rows[0].getDataValue('tasks').map(task => task.toJSON()), [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
  });

  it('supports required lazy includes with MapAdapter', async () => {
    if (testAdapterName() !== 'sqlite') return;

    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } }, { timestamps: false });
    Task.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, userId: { type: DataTypes.INTEGER } }, { timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const seq = new Seq({ adapter: new MapAdapter(), models: [User, Task], logging: false });
    await seq.init(); await seq.sync(); open.push({ seq, adapter: seq.adapter, models: [User, Task] });
    await User.bulkCreate([{}, {}]); await Task.create({ userId: 1 });
    const rows = await User.findAll({ include: [{ model: Task, required: true }] });
    assert.deepEqual(rows.map(row => row.getDataValue('id')), [1]);
  });

  it('supports lazy include where clauses when columns use snake_case', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING } }, { tableName: testTable('users'), timestamps: false });
    Task.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER },
      completed: { type: DataTypes.BOOLEAN }
    }, { tableName: testTable('tasks'), timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const context = await createTestContext({ models: [User, Task], logging: false });
    const seq = context.seq;
    await seq.sync(); open.push(context);
    await User.bulkCreate([{ name: 'Ana' }, { name: 'Juan' }]);
    await Task.bulkCreate([
      { userId: 1, completed: true },
      { userId: 1, completed: false },
      { userId: 2, completed: true }
    ]);
    const rows = await User.findAll({ include: [{ model: Task, where: { completed: true } }] });
    assert.deepEqual(rows.map(row => row.getDataValue('tasks').length), [1, 1]);
  });

  it('supports two aliased associations to the same model', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING } }, { tableName: testTable('users'), timestamps: false });
    Task.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      creatorId: { type: DataTypes.INTEGER },
      updaterId: { type: DataTypes.INTEGER }
    }, { tableName: testTable('tasks'), timestamps: false });
    Task.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });
    Task.belongsTo(User, { foreignKey: 'updaterId', as: 'updater' });
    const context = await createTestContext({ models: [User, Task], logging: false });
    const seq = context.seq;
    await seq.sync(); open.push(context);
    await User.bulkCreate([{ name: 'Ana' }, { name: 'Bea' }]);
    await Task.create({ creatorId: 1, updaterId: 2 });
    const row = await Task.findOne({ include: [{ model: User, as: 'creator', eager: true }, { model: User, as: 'updater', eager: true }] });
    assert.equal(row.getDataValue('creator').getDataValue('name'), 'Ana');
    assert.equal(row.getDataValue('updater').getDataValue('name'), 'Bea');
  });

  it('rejects circular and bigint JSON values without overflowing', () => {
    const circular = {}; circular.self = circular;
    assert.equal(DataTypes.JSON.validate(circular).valid, false);
    assert.equal(DataTypes.JSON.validate({ value: 1n }).valid, false);
  });
});

describe('Explicit transactions', () => {
  it('keeps Map changes private until commit and rejects missing tokens', async () => {
    if (testAdapterName() !== 'sqlite') return;

    const { seq, ModelClass } = await setup(new MapAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING }
    });
    const transaction = await seq.adapter.tcl.begin();
    await assert.rejects(() => ModelClass.create({ name: 'missing' }), error => error.code === 'SEQ_ADAPTER_TRANSACTION_REQUIRED');
    await ModelClass.create({ name: 'committed' }, { transaction });
    assert.equal(await ModelClass.count({ transaction }), 1);
    await seq.adapter.tcl.commit(transaction);
    assert.equal(await ModelClass.count(), 1);
  });
});
