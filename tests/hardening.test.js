import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, MapAdapter, Model, Op, Seq, SQLiteAdapter } from '../src/index.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop().close();
});

async function setup(adapter, attributes, options = {}) {
  class TestModel extends Model {}
  TestModel.init(attributes, { modelName: options.modelName || 'TestModel', tableName: options.tableName || 'test_models', timestamps: false });
  const seq = new Seq({ adapter, models: [TestModel], logging: false });
  await seq.init();
  await seq.sync();
  open.push(seq);
  return { seq, ModelClass: TestModel };
}

describe('SQL and validation hardening', () => {
  it('rejects injected and unknown order clauses', async () => {
    const { ModelClass } = await setup(new SQLiteAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING }
    });
    await assert.rejects(() => ModelClass.findAll({ order: [['id', 'DESC LIMIT 1']] }), error => error.code === 'SEQ_VALIDATION_ORDER');
    await assert.rejects(() => ModelClass.findAll({ order: [['missing', 'ASC']] }), error => error.code === 'SEQ_VALIDATION_ORDER');
  });

  it('handles null and empty IN predicates consistently', async () => {
    for (const adapter of [new SQLiteAdapter(), new MapAdapter()]) {
      const { ModelClass } = await setup(adapter, {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        value: { type: DataTypes.STRING, allowNull: true }
      }, { tableName: `nulls_${open.length}` });
      await ModelClass.create({ value: null });
      assert.equal(await ModelClass.count({ where: { value: null } }), 1);
      assert.equal(await ModelClass.count({ where: { id: { [Op.in]: [] } } }), 0);
      assert.equal(await ModelClass.count({ where: { id: { [Op.notIn]: [] } } }), 1);
    }
  });

  it('quotes identifiers and string defaults safely', async () => {
    const { ModelClass } = await setup(new SQLiteAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      odd: { type: DataTypes.STRING, field: 'odd"column', defaultValue: "O'Brien" }
    });
    const row = await ModelClass.create({});
    assert.equal(row.getDataValue('odd'), "O'Brien");
  });

  it('validates SQLite updates and returns rows when the where field changes', async () => {
    const { ModelClass } = await setup(new SQLiteAdapter(), {
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
    const { ModelClass } = await setup(new SQLiteAdapter(), {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
    });
    assert.equal((await ModelClass.create({})).getDataValue('id'), 1);
  });
});

describe('Map atomicity', () => {
  it('rolls back failed updates and bulk inserts', async () => {
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
  it('adds a physically missing column after reopening', async () => {
    class User extends Model {}
    User.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
      added: { type: DataTypes.STRING }
    }, { modelName: 'User', tableName: 'users', timestamps: false });
    const adapter = new SQLiteAdapter();
    await adapter.connect();
    adapter._db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const seq = new Seq({ adapter, models: [User], logging: false });
    await seq.init();
    open.push(seq);
    const result = await seq.sync({ alter: true });
    assert.deepEqual(result.altered, ['users']);
    assert.ok(adapter._db.pragma('table_info(users)').some(column => column.name === 'added'));
  });
});

describe('Includes and data types', () => {
  it('does not truncate eager child collections when paginating parents', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } }, { timestamps: false });
    Task.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, userId: { type: DataTypes.INTEGER }, title: { type: DataTypes.STRING } }, { timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const seq = new Seq({ adapter: new SQLiteAdapter(), models: [User, Task], logging: false });
    await seq.init(); await seq.sync(); open.push(seq);
    await User.create({});
    await Task.bulkCreate([{ userId: 1, title: 'a' }, { userId: 1, title: 'b' }, { userId: 1, title: 'c' }]);
    const rows = await User.findAll({ include: [{ model: Task, eager: true, attributes: ['title'] }], limit: 1 });
    assert.deepEqual(rows[0].getDataValue('tasks').map(task => task.toJSON()), [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
  });

  it('supports required lazy includes with MapAdapter', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } }, { timestamps: false });
    Task.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, userId: { type: DataTypes.INTEGER } }, { timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const seq = new Seq({ adapter: new MapAdapter(), models: [User, Task], logging: false });
    await seq.init(); await seq.sync(); open.push(seq);
    await User.bulkCreate([{}, {}]); await Task.create({ userId: 1 });
    const rows = await User.findAll({ include: [{ model: Task, required: true }] });
    assert.deepEqual(rows.map(row => row.getDataValue('id')), [1]);
  });

  it('supports lazy include where clauses when columns use snake_case', async () => {
    class User extends Model {}
    class Task extends Model {}
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING } }, { timestamps: false });
    Task.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.INTEGER },
      completed: { type: DataTypes.BOOLEAN }
    }, { timestamps: false });
    User.hasMany(Task, { foreignKey: 'userId' });
    const seq = new Seq({
      adapter: new SQLiteAdapter(),
      models: [User, Task],
      naming: { tables: 'snake_case', columns: 'snake_case' },
      logging: false
    });
    await seq.init(); await seq.sync(); open.push(seq);
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
    User.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING } }, { timestamps: false });
    Task.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      creatorId: { type: DataTypes.INTEGER },
      updaterId: { type: DataTypes.INTEGER }
    }, { timestamps: false });
    Task.belongsTo(User, { foreignKey: 'creatorId', as: 'creator' });
    Task.belongsTo(User, { foreignKey: 'updaterId', as: 'updater' });
    const seq = new Seq({ adapter: new SQLiteAdapter(), models: [User, Task], logging: false });
    await seq.init(); await seq.sync(); open.push(seq);
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
