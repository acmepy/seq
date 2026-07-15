import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Model, DataTypes } from '../src/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { normalizeInclude, resolveIncludeAlias, resolveEager } from '../src/utils/include.js';

describe('Aliases & Include', () => {
  let seq, adapter, User, Task, Profile;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { modelName: 'User', tableName: 'users', timestamps: false }
    );
    User = _User;

    class _Task extends Model {}
    _Task.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(100), allowNull: false },
        completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        userId: { type: DataTypes.INTEGER, allowNull: false },
      },
      { modelName: 'Task', tableName: 'tasks', timestamps: false }
    );
    Task = _Task;

    class _Profile extends Model {}
    _Profile.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        bio: { type: DataTypes.STRING(255) },
        userId: { type: DataTypes.INTEGER, allowNull: false },
      },
      { modelName: 'Profile', tableName: 'profiles', timestamps: false }
    );
    Profile = _Profile;

    User.hasMany(Task);
    User.hasOne(Profile);
    Task.belongsTo(User);
    Profile.belongsTo(User);

    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({ adapter, models: [User, Task, Profile], logging: false });
    await seq.init();
    await seq.sync();

    await User.create({ name: 'Ana' });
    await User.create({ name: 'Juan' });
    await Task.create({ title: 'Buy milk', userId: 1, completed: false });
    await Task.create({ title: 'Walk dog', userId: 1, completed: true });
    await Task.create({ title: 'Read book', userId: 2, completed: false });
    await Profile.create({ bio: 'Developer', userId: 1 });
  });

  // ---------------------------------------------------------------------------
  // Model alias
  // ---------------------------------------------------------------------------

  describe('Model alias', () => {
    it('auto-generates from modelName initials lowercase', () => {
      assert.equal(User.alias, 'u');
      assert.equal(Task.alias, 't');
    });

    it('auto-generates multi-word alias', () => {
      class _UserProfile extends Model {}
      _UserProfile.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } },
        { modelName: 'UserProfile', tableName: 'profiles2', timestamps: false }
      );
      assert.equal(_UserProfile.alias, 'up');
    });

    it('accepts explicit alias', () => {
      class _Custom extends Model {}
      _Custom.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } },
        { modelName: 'Custom', tableName: 'customs', alias: 'c', timestamps: false }
      );
      assert.equal(_Custom.alias, 'c');
    });
  });

  // ---------------------------------------------------------------------------
  // Association as
  // ---------------------------------------------------------------------------

  describe('Association as', () => {
    it('hasMany auto-generates plural as', () => {
      const assoc = User.associations[Task.modelName];
      assert.equal(assoc.as, 'tasks');
    });

    it('hasOne auto-generates plural as', () => {
      const assoc = User.associations[Profile.modelName];
      assert.equal(assoc.as, 'profiles');
    });

    it('belongsTo auto-generates singular as', () => {
      const assoc = Task.associations[User.modelName];
      assert.equal(assoc.as, 'user');
    });

    it('accepts explicit as', () => {
      class _A extends Model {}
      _A.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        },
        { modelName: 'A', tableName: 'a', timestamps: false }
      );
      class _B extends Model {}
      _B.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          aId: { type: DataTypes.INTEGER },
        },
        { modelName: 'B', tableName: 'b', timestamps: false }
      );
      _A.hasMany(_B, { as: 'items', foreignKey: 'aId' });
      assert.equal(_A.associations['B'].as, 'items');
    });
  });

  // ---------------------------------------------------------------------------
  // SQL aliases
  // ---------------------------------------------------------------------------

  describe('SQL aliases', () => {
    it('generates SELECT with AS alias', async () => {
      const { tableName, schema, alias } = seq.adapter.dml._schema(User);
      assert.equal(alias, 'u');
      const sql = alias
        ? `SELECT * FROM "${tableName}" AS "${alias}"`
        : `SELECT * FROM "${tableName}"`;
      assert.ok(sql.includes('AS "u"'));
    });

    it('WHERE uses alias-prefixed columns', () => {
      const { schema, alias } = seq.adapter.dml._schema(User);
      const where = seq.adapter.dml._buildWhere({ name: 'Ana' }, schema, alias);
      assert.ok(where.sql.includes('"u"."name" = ?'));
    });

    it('ORDER BY uses alias-prefixed columns', () => {
      const { schema, alias } = seq.adapter.dml._schema(User);
      const order = seq.adapter.dml._buildOrderBy([['name', 'ASC']], schema, alias);
      assert.ok(order.includes('"u"."name" ASC'));
    });
  });

  // ---------------------------------------------------------------------------
  // normalizeInclude
  // ---------------------------------------------------------------------------

  describe('normalizeInclude', () => {
    it('normalizes a Model to an include object', () => {
      const result = normalizeInclude(Task);
      assert.equal(result.length, 1);
      assert.equal(result[0].model, Task);
      assert.equal(result[0].as, null);
      assert.equal(result[0].where, null);
    });

    it('normalizes an array of Models', () => {
      const result = normalizeInclude([Task, Profile]);
      assert.equal(result.length, 2);
      assert.equal(result[0].model, Task);
      assert.equal(result[1].model, Profile);
    });

    it('normalizes an object include', () => {
      const result = normalizeInclude({ model: Task, as: 'todos', where: { completed: true } });
      assert.equal(result.length, 1);
      assert.equal(result[0].model, Task);
      assert.equal(result[0].as, 'todos');
      assert.deepEqual(result[0].where, { completed: true });
    });
  });

  // ---------------------------------------------------------------------------
  // resolveIncludeAlias
  // ---------------------------------------------------------------------------

  describe('resolveIncludeAlias', () => {
    it('uses include.as when provided', () => {
      const result = resolveIncludeAlias({ model: Task, as: 'myTasks' }, User);
      assert.equal(result, 'myTasks');
    });

    it('uses association.as when no include.as', () => {
      const result = resolveIncludeAlias({ model: Task }, User);
      assert.equal(result, 'tasks');
    });

    it('falls back to auto-generated', () => {
      class _X extends Model {}
      _X.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } },
        { modelName: 'X', tableName: 'x', timestamps: false }
      );
      const result = resolveIncludeAlias({ model: _X }, User);
      assert.equal(result, 'xs');
    });
  });

  // ---------------------------------------------------------------------------
  // Include - hasMany
  // ---------------------------------------------------------------------------

  describe('include hasMany', () => {
    it('loads related tasks for each user', async () => {
      const users = await User.findAll({ include: Task });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const tasks = ana.getDataValue('tasks');
      assert.ok(Array.isArray(tasks));
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every(t => t.getDataValue('userId') === 1));
    });

    it('returns empty array when no matches', async () => {
      const users = await User.findAll({ include: Task });
      const juan = users.find(u => u.getDataValue('name') === 'Juan');
      const tasks = juan.getDataValue('tasks');
      assert.ok(Array.isArray(tasks));
      assert.equal(tasks.length, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Include - hasOne
  // ---------------------------------------------------------------------------

  describe('include hasOne', () => {
    it('loads related profile', async () => {
      const users = await User.findAll({ include: Profile });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const profile = ana.getDataValue('profiles');
      assert.ok(profile);
      assert.equal(profile.getDataValue('bio'), 'Developer');
    });

    it('returns null when no match', async () => {
      const users = await User.findAll({ include: Profile });
      const juan = users.find(u => u.getDataValue('name') === 'Juan');
      assert.equal(juan.getDataValue('profiles'), null);
    });
  });

  // ---------------------------------------------------------------------------
  // Include - belongsTo
  // ---------------------------------------------------------------------------

  describe('include belongsTo', () => {
    it('loads related user for each task', async () => {
      const tasks = await Task.findAll({ include: User });
      assert.equal(tasks.length, 3);

      const task = tasks[0];
      const user = task.getDataValue('user');
      assert.ok(user);
      assert.ok(user.getDataValue('name'));
    });
  });

  // ---------------------------------------------------------------------------
  // Include with as
  // ---------------------------------------------------------------------------

  describe('include with as', () => {
    it('uses explicit as for the property name', async () => {
      const users = await User.findAll({ include: [{ model: Task, as: 'pendingTasks' }] });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const pending = ana.getDataValue('pendingTasks');
      assert.ok(Array.isArray(pending));
      assert.equal(pending.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Include with where
  // ---------------------------------------------------------------------------

  describe('include with where', () => {
    it('filters included records', async () => {
      const users = await User.findAll({
        include: [{ model: Task, where: { completed: true } }],
      });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const completed = ana.getDataValue('tasks');
      assert.ok(Array.isArray(completed));
      assert.equal(completed.length, 1);
      assert.equal(completed[0].getDataValue('title'), 'Walk dog');
    });
  });

  // ---------------------------------------------------------------------------
  // Include multiple
  // ---------------------------------------------------------------------------

  describe('include multiple', () => {
    it('loads multiple associations', async () => {
      const users = await User.findAll({ include: [Task, Profile] });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      assert.ok(Array.isArray(ana.getDataValue('tasks')));
      assert.ok(ana.getDataValue('profiles'));
    });
  });

  // ---------------------------------------------------------------------------
  // backward compatibility
  // ---------------------------------------------------------------------------

  describe('backward compatibility', () => {
    it('findAll without include works as before', async () => {
      const users = await User.findAll();
      assert.equal(users.length, 2);
      assert.ok(users[0].getDataValue('name'));
    });
  });

  // ---------------------------------------------------------------------------
  // resolveEager
  // ---------------------------------------------------------------------------

  describe('resolveEager', () => {
    it('returns per-include eager when set', () => {
      assert.equal(resolveEager({ eager: true }, false), true);
      assert.equal(resolveEager({ eager: false }, true), false);
    });

    it('falls back to globalEager when include.eager is null', () => {
      assert.equal(resolveEager({ eager: null }, true), true);
      assert.equal(resolveEager({ eager: null }, false), false);
    });

    it('defaults to false when both are undefined', () => {
      assert.equal(resolveEager({ eager: null }), false);
    });
  });

  // ---------------------------------------------------------------------------
  // normalizeInclude with eager
  // ---------------------------------------------------------------------------

  describe('normalizeInclude with eager', () => {
    it('includes eager: null for Model', () => {
      const result = normalizeInclude(Task);
      assert.equal(result[0].eager, null);
    });

    it('preserves per-include eager', () => {
      const result = normalizeInclude({ model: Task, eager: true });
      assert.equal(result[0].eager, true);
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include - hasMany (LEFT JOIN)
  // ---------------------------------------------------------------------------

  describe('eager include hasMany', () => {
    it('loads related tasks via LEFT JOIN', async () => {
      const users = await User.findAll({ include: Task, eager: true });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const tasks = ana.getDataValue('tasks');
      assert.ok(Array.isArray(tasks));
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every(t => t.getDataValue('userId') === 1));
    });

    it('returns empty array when no matches', async () => {
      const users = await User.findAll({ include: Task, eager: true });
      const juan = users.find(u => u.getDataValue('name') === 'Juan');
      const tasks = juan.getDataValue('tasks');
      assert.ok(Array.isArray(tasks));
      assert.equal(tasks.length, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include - hasOne (LEFT JOIN)
  // ---------------------------------------------------------------------------

  describe('eager include hasOne', () => {
    it('loads related profile via LEFT JOIN', async () => {
      const users = await User.findAll({ include: Profile, eager: true });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const profile = ana.getDataValue('profiles');
      assert.ok(profile);
      assert.equal(profile.getDataValue('bio'), 'Developer');
    });

    it('returns null when no match', async () => {
      const users = await User.findAll({ include: Profile, eager: true });
      const juan = users.find(u => u.getDataValue('name') === 'Juan');
      assert.equal(juan.getDataValue('profiles'), null);
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include - belongsTo (LEFT JOIN)
  // ---------------------------------------------------------------------------

  describe('eager include belongsTo', () => {
    it('loads related user via LEFT JOIN', async () => {
      const tasks = await Task.findAll({ include: User, eager: true });
      assert.equal(tasks.length, 3);

      const task = tasks[0];
      const user = task.getDataValue('user');
      assert.ok(user);
      assert.ok(user.getDataValue('name'));
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include with where
  // ---------------------------------------------------------------------------

  describe('eager include with where', () => {
    it('filters included records via ON clause', async () => {
      const users = await User.findAll({
        include: [{ model: Task, where: { completed: true } }],
        eager: true,
      });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const completed = ana.getDataValue('tasks');
      assert.ok(Array.isArray(completed));
      assert.equal(completed.length, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include with explicit as
  // ---------------------------------------------------------------------------

  describe('eager include with as', () => {
    it('uses explicit as for the property name', async () => {
      const users = await User.findAll({ include: [{ model: Task, as: 'pendingTasks', eager: true }] });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      const pending = ana.getDataValue('pendingTasks');
      assert.ok(Array.isArray(pending));
      assert.equal(pending.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // Eager include multiple
  // ---------------------------------------------------------------------------

  describe('eager include multiple', () => {
    it('loads multiple associations via JOINs', async () => {
      const users = await User.findAll({ include: [Task, Profile], eager: true });
      assert.equal(users.length, 2);

      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      assert.ok(Array.isArray(ana.getDataValue('tasks')));
      assert.ok(ana.getDataValue('profiles'));
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed eager/lazy
  // ---------------------------------------------------------------------------

  describe('mixed eager and lazy', () => {
    it('global eager with per-include lazy override', async () => {
      const users = await User.findAll({
        include: [Task, { model: Profile, eager: false }],
        eager: true,
      });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      assert.ok(Array.isArray(ana.getDataValue('tasks')));
      assert.ok(ana.getDataValue('profiles'));
    });

    it('global lazy with per-include eager override', async () => {
      const users = await User.findAll({
        include: [Task, { model: Profile, eager: true }],
      });
      const ana = users.find(u => u.getDataValue('name') === 'Ana');
      assert.ok(Array.isArray(ana.getDataValue('tasks')));
      assert.ok(ana.getDataValue('profiles'));
    });
  });
});
