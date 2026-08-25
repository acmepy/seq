import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, MapAdapter, Model, Op, Seq, SQLiteAdapter } from '../src/index.js';
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
  it('adds a createdAt index when altering an existing table', async () => {
    class Audit extends Model {}
    Audit.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        txId: { type: DataTypes.STRING(50), allowNull: false },
        clientIp: { type: DataTypes.STRING(50), allowNull: false },
        userId: { type: DataTypes.STRING(20) },
        tableName: { type: DataTypes.STRING(50), allowNull: false },
        rowId: { type: DataTypes.STRING(50), allowNull: false },
        action: { type: DataTypes.STRING(20), allowNull: false },
        old: { type: DataTypes.JSON },
        new: { type: DataTypes.JSON }
      },
      { modelName: 'audit', tableName: testTable('audit'), timestamps: true }
    );

    const context = await createTestContext({ models: [Audit], logging: false });
    open.push(context);
    const { seq, adapter } = context;
    await seq.sync();

    Audit.options.indexes = [{ name: 'idx_audit_created_at', columns: ['createdAt'] }];
    const definition = seq._buildTableDefinition(Audit);
    const result = await seq.sync({ alter: true });

    assert.deepEqual(result.altered, [definition.tableName]);
    assert.deepEqual(definition.indexes, [{
      name: 'idx_audit_created_at',
      columns: [definition.attrToColumn.createdAt],
      unique: false
    }]);

    const physicalDefinition = await adapter.ddl.introspectDefinition(definition);
    assert.deepEqual(physicalDefinition.indexes, definition.indexes);
  });

  it('reconciles existing camelCase timestamps when reopening', async () => {
    if (testAdapterName() === 'sqlite') {
      class User extends Model {}
      User.init({
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        added: { type: DataTypes.STRING }
      }, { modelName: 'User', tableName: 'users' });
      const adapter = new SQLiteAdapter();
      await adapter.connect();
      adapter._db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, createdAt TEXT)');
      const introspectDefinition = adapter.ddl.introspectDefinition.bind(adapter.ddl);
      adapter.ddl.introspectDefinition = async definition => {
        await Promise.resolve();
        return introspectDefinition(definition);
      };
      const seq = new Seq({ adapter, models: [User], logging: false });
      await seq.init();
      open.push({ seq, adapter, models: [User] });
      assert.ok(adapter.schemas.has('users'));
      const schema = adapter.schemas.get('users');
      assert.equal(schema.attrToColumn.createdAt, 'createdAt');
      assert.equal(schema.columns.updatedAt, undefined);
      const result = await seq.sync({ alter: true });
      assert.deepEqual(result.altered, ['users']);
      const columns = adapter._db.pragma('table_info(users)').map(column => column.name);
      assert.ok(columns.includes('added'));
      assert.ok(columns.includes('createdAt'));
      assert.equal(columns.includes('created_at'), false);
      assert.ok(columns.includes('updated_at'));
      return;
    }

    const tableName = testTable('schema_introspection');
    class InitialUser extends Model {}
    InitialUser.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
      createdAt: { type: DataTypes.DATE, field: 'createdAt' }
    }, { modelName: 'InitialUser', tableName, timestamps: false });

    const initialContext = await createTestContext({ models: [InitialUser], logging: false });
    try {
      await initialContext.seq.sync();
    } finally {
      await initialContext.seq.close();
    }

    class ReopenedUser extends Model {}
    ReopenedUser.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
      added: { type: DataTypes.STRING }
    }, { modelName: 'ReopenedUser', tableName });

    const context = await createTestContext({ models: [ReopenedUser], logging: false });
    open.push(context);
    const { seq, adapter } = context;
    const definition = seq._buildTableDefinition(ReopenedUser);
    const schema = adapter.schemas.get(definition.tableName);
    assert.ok(schema);
    assert.equal(schema.columns.added, undefined);
    assert.ok(schema.columns.createdAt);
    assert.equal(schema.columns.updatedAt, undefined);
    assert.notEqual(schema.attrToColumn.createdAt, definition.attrToColumn.createdAt);

    const result = await seq.sync({ alter: true });
    assert.deepEqual(result.altered, [definition.tableName]);
    const physicalColumns = new Set((await adapter.ddl.describeTable(definition.tableName)).columns.map(column => column.name));
    for (const name of ['added', 'updatedAt']) {
      assert.ok(physicalColumns.has(definition.attrToColumn[name]), `${name} column was added`);
    }
    assert.ok(physicalColumns.has(schema.attrToColumn.createdAt));
    assert.equal(physicalColumns.has(definition.attrToColumn.createdAt), false);
  });

  it('adds missing timestamp columns when reopening', async () => {
    if (testAdapterName() === 'sqlite') {
      class User extends Model {}
      User.init({
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING }
      }, { modelName: 'User', tableName: 'users_missing_timestamps' });
      const adapter = new SQLiteAdapter();
      await adapter.connect();
      adapter._db.exec('CREATE TABLE users_missing_timestamps (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
      const seq = new Seq({ adapter, models: [User], logging: false });
      await seq.init();
      open.push({ seq, adapter, models: [User] });
      const result = await seq.sync({ alter: true });
      assert.deepEqual(result.altered, ['users_missing_timestamps']);
      const columns = adapter._db.pragma('table_info(users_missing_timestamps)').map(column => column.name);
      assert.ok(columns.includes('created_at'));
      assert.ok(columns.includes('updated_at'));
      return;
    }

    const tableName = testTable('missing_timestamps');
    class InitialUser extends Model {}
    InitialUser.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING }
    }, { modelName: 'InitialUser', tableName, timestamps: false });

    const initialContext = await createTestContext({ models: [InitialUser], logging: false });
    try {
      await initialContext.seq.sync();
    } finally {
      await initialContext.seq.close();
    }

    class ReopenedUser extends Model {}
    ReopenedUser.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING }
    }, { modelName: 'ReopenedUser', tableName });

    const context = await createTestContext({ models: [ReopenedUser], logging: false });
    open.push(context);
    const { seq, adapter } = context;
    const definition = seq._buildTableDefinition(ReopenedUser);
    const schema = adapter.schemas.get(definition.tableName);
    assert.equal(schema.columns.createdAt, undefined);
    assert.equal(schema.columns.updatedAt, undefined);

    const result = await seq.sync({ alter: true });
    assert.deepEqual(result.altered, [definition.tableName]);
    const physicalColumns = new Set((await adapter.ddl.describeTable(definition.tableName)).columns.map(column => column.name));
    assert.ok(physicalColumns.has(definition.attrToColumn.createdAt));
    assert.ok(physicalColumns.has(definition.attrToColumn.updatedAt));
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
