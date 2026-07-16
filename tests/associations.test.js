import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Associations', () => {
  let seq, adapter;
  let User, Task, Profile;

  function defineModels(options = {}) {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'User', tableName: 'users', ...options.user }
    );

    class _Task extends Model {}
    _Task.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(100), allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: false }
      },
      { modelName: 'Task', tableName: 'tasks', ...options.task }
    );

    class _Profile extends Model {}
    _Profile.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        bio: { type: DataTypes.STRING(200) },
        userId: { type: DataTypes.INTEGER, allowNull: false, unique: true }
      },
      { modelName: 'Profile', tableName: 'profiles', ...options.profile }
    );

    User = _User;
    Task = _Task;
    Profile = _Profile;
  }

  async function createSeq(models, opts = {}) {
    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({
      adapter,
      models,
      ...opts,
      logging: false
    });
    await seq.init();
    return seq;
  }

  afterEach(async () => {
    if (seq) await seq.close();
  });

  describe('Association declaration', () => {
    beforeEach(() => { defineModels(); });

    it('hasMany stores association on source model', () => {
      User.hasMany(Task, { foreignKey: 'userId' });
      assert.ok(User.associations.Task);
      assert.equal(User.associations.Task.type, 'hasMany');
      assert.equal(User.associations.Task.foreignKey, 'userId');
    });

    it('hasOne stores association on source model', () => {
      User.hasOne(Profile, { foreignKey: 'userId' });
      assert.ok(User.associations.Profile);
      assert.equal(User.associations.Profile.type, 'hasOne');
    });

    it('belongsTo stores association on source model', () => {
      Task.belongsTo(User, { foreignKey: 'userId' });
      assert.ok(Task.associations.User);
      assert.equal(Task.associations.User.type, 'belongsTo');
      assert.equal(Task.associations.User.foreignKey, 'userId');
    });

    it('belongsToMany stores association with through', () => {
      class Role extends Model {}
      Role.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(50) } },
        { modelName: 'Role', tableName: 'roles' }
      );
      User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'userId', otherKey: 'roleId' });
      assert.ok(User.associations.Role);
      assert.equal(User.associations.Role.type, 'belongsToMany');
      assert.equal(User.associations.Role.through, 'user_roles');
      assert.equal(User.associations.Role.foreignKey, 'userId');
      assert.equal(User.associations.Role.otherKey, 'roleId');
    });

    it('belongsToMany accepts a through model', () => {
      class Role extends Model {}
      Role.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(50) } },
        { modelName: 'Role', tableName: 'roles' }
      );
      class UserRole extends Model {}
      UserRole.init(
        {
          userId: { type: DataTypes.INTEGER, allowNull: false },
          roleId: { type: DataTypes.INTEGER, allowNull: false }
        },
        { modelName: 'UserRole', tableName: 'users_roles', timestamps: false }
      );

      User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', otherKey: 'roleId', as: 'roles' });

      assert.equal(User.associations.Role.type, 'belongsToMany');
      assert.equal(User.associations.Role.through, UserRole);
      assert.equal(User.associations.Role.throughModel, UserRole);
      assert.equal(User.associations.Role.throughTable, 'users_roles');
      assert.equal(User.associations.Role.as, 'roles');
    });

    it('hasMany requires target to have FK attribute', () => {
      class Bad extends Model {}
      Bad.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true } },
        { modelName: 'Bad', tableName: 'bads' }
      );
      assert.throws(
        () => User.hasMany(Bad),
        (err) => err.code === 'SEQ_ASSOCIATION_MISSING_FK'
      );
    });

    it('belongsTo requires source to have FK attribute', () => {
      class Bad extends Model {}
      Bad.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true } },
        { modelName: 'Bad', tableName: 'bads' }
      );
      assert.throws(
        () => Bad.belongsTo(User),
        (err) => err.code === 'SEQ_ASSOCIATION_MISSING_FK'
      );
    });

    it('belongsToMany requires through option', () => {
      assert.throws(
        () => User.belongsToMany(Task),
        (err) => err.code === 'SEQ_ASSOCIATION_MISSING_THROUGH'
      );
    });

    it('hasMany requires valid target model', () => {
      assert.throws(
        () => User.hasMany(null),
        (err) => err.code === 'SEQ_ASSOCIATION_INVALID_TARGET'
      );
    });

    it('supports chaining', () => {
      const result = User.hasMany(Task, { foreignKey: 'userId' }).hasMany(Profile, { foreignKey: 'userId' });
      assert.equal(result, User);
      assert.ok(User.associations.Task);
      assert.ok(User.associations.Profile);
    });
  });

  describe('FK in table definition (references in attributes)', () => {
    it('builds foreignKeys from attribute references', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id' } }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      await createSeq([_User, _Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].attributeName, 'userId');
      assert.equal(schema.foreignKeys[0].references.model, 'User');
      assert.equal(schema.foreignKeys[0].references.key, 'id');
      assert.equal(schema.foreignKeys[0].onDelete, 'RESTRICT');
    });

    it('builds foreignKeys from associations', async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });
      Task.belongsTo(User, { foreignKey: 'userId' });
      User.hasOne(Profile, { foreignKey: 'userId' });

      await createSeq([User, Task, Profile]);
      await seq.sync();

      const taskSchema = seq._adapter.schemas.get('tasks');
      const fk = taskSchema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.ok(fk);
      assert.equal(fk.references.model, 'User');
      assert.equal(fk.references.key, 'id');

      const profileSchema = seq._adapter.schemas.get('profiles');
      const pfk = profileSchema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.ok(pfk);
      assert.equal(pfk.references.model, 'User');
    });

    it('respects naming conventions for FK column resolution', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      _User.hasMany(_Task, { foreignKey: 'userId' });

      adapter = new SQLiteAdapter({ database: ':memory:' });
      await adapter.connect();
      seq = new Seq({
        adapter,
        models: [_User, _Task],
        naming: { columns: 'snake_case' },
        logging: false
      });
      await seq.init();
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.ok(fk);
      assert.equal(fk.columnName, 'user_id');
      assert.equal(fk.references.column, 'id');
    });
  });

  describe('FK validation on insert', () => {
    beforeEach(async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });
      await createSeq([User, Task]);
      await seq.sync();
    });

    it('inserts record with valid FK', async () => {
      const user = await User.create({ name: 'Ana' });
      const task = await Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      assert.ok(task);
    });

    it('rejects insert with invalid FK', async () => {
      await assert.rejects(
        () => Task.create({ title: 'Task 1', userId: 999 })
      );
    });

    it('allows null FK when allowNull: true', async () => {
      class _Task2 extends Model {}
      _Task2.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, allowNull: true }
        },
        { modelName: 'Task2', tableName: 'tasks2' }
      );
      User.hasMany(_Task2, { foreignKey: 'userId' });

      seq = new Seq({ adapter, models: [User, _Task2], logging: false });
      await seq.init();
      await seq.sync();

      const task = await _Task2.create({ title: 'Task null' });
      assert.ok(task);
      assert.equal(task.getDataValue('userId'), null);
    });
  });

  describe('FK validation on update', () => {
    beforeEach(async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });
      await createSeq([User, Task]);
      await seq.sync();
    });

    it('updates FK to valid value', async () => {
      const user1 = await User.create({ name: 'Ana' });
      const user2 = await User.create({ name: 'Juan' });
      const task = await Task.create({ title: 'Task 1', userId: user1.getDataValue('id') });
      await task.update({ userId: user2.getDataValue('id') });
      assert.equal(task.getDataValue('userId'), user2.getDataValue('id'));
    });

    it('rejects update to invalid FK', async () => {
      const user = await User.create({ name: 'Ana' });
      const task = await Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      await assert.rejects(
        () => task.update({ userId: 999 })
      );
    });
  });

  describe('references in attributes', () => {
    it('validates FK from attribute references on insert', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id' } }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      await createSeq([_User, _Task]);
      await seq.sync();

      const user = await _User.create({ name: 'Ana' });
      const task = await _Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      assert.ok(task);

      await assert.rejects(
        () => _Task.create({ title: 'Bad', userId: 999 })
      );
    });
  });

  describe('Cascade RESTRICT', () => {
    beforeEach(async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
      await createSeq([User, Task]);
      await seq.sync();
    });

    it('rejects delete of parent with children', async () => {
      const user = await User.create({ name: 'Ana' });
      await Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      await assert.rejects(
        () => user.destroy()
      );
    });

    it('allows delete of parent without children', async () => {
      const user = await User.create({ name: 'Ana' });
      await user.destroy();
      assert.equal(await User.count(), 0);
    });
  });

  describe('Cascade CASCADE', () => {
    beforeEach(async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
      await createSeq([User, Task]);
      await seq.sync();
    });

    it('deletes children when parent is deleted', async () => {
      const user = await User.create({ name: 'Ana' });
      await Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      await Task.create({ title: 'Task 2', userId: user.getDataValue('id') });
      assert.equal(await Task.count(), 2);
      await user.destroy();
      assert.equal(await Task.count(), 0);
    });
  });

  describe('Cascade SET NULL', () => {
    it('sets FK to null when parent is deleted', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, allowNull: true }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      _User.hasMany(_Task, { foreignKey: 'userId', onDelete: 'SET NULL' });

      await createSeq([_User, _Task]);
      await seq.sync();

      const user = await _User.create({ name: 'Ana' });
      const task = await _Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      assert.equal(task.getDataValue('userId'), user.getDataValue('id'));
      await _User.destroy({ where: { id: user.getDataValue('id') } });
      const updated = await _Task.findByPk(task.getDataValue('id'));
      assert.equal(updated.getDataValue('userId'), null);
    });
  });

  describe('Cascade on PK update', () => {
    it('CASCADE updates FK in children', async () => {
      class _User extends Model {}
      _User.init(
        { userId: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userUserId: { type: DataTypes.INTEGER }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      _User.hasMany(_Task, { foreignKey: 'userUserId', onUpdate: 'CASCADE' });

      await createSeq([_User, _Task]);
      await seq.sync();

      const user = await _User.create({ name: 'Ana' });
      const task = await _Task.create({ title: 'Task 1', userUserId: user.getDataValue('userId') });
      assert.equal(task.getDataValue('userUserId'), user.getDataValue('userId'));

      const oldPk = user.getDataValue('userId');
      const newPk = oldPk + 100;
      await _User.update({ userId: newPk }, { where: { userId: oldPk } });
      const updated = await _Task.findByPk(task.getDataValue('id'));
      assert.equal(updated.getDataValue('userUserId'), newPk);
    });
  });

  describe('Model.build with FK attributes', () => {
    it('builds instance with FK values', () => {
      defineModels();
      const task = Task.build({ title: 'Task 1', userId: 42 });
      assert.equal(task.getDataValue('userId'), 42);
    });
  });

  describe('constraintName', () => {
    it('auto-generates from fk_{source_table}_{target_table} on hasMany', async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });

      await createSeq([User, Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'fk_tasks_users');
    });

    it('auto-generates from fk_{source_table}_{target_table} on belongsTo', async () => {
      defineModels();
      Task.belongsTo(User, { foreignKey: 'userId' });

      await createSeq([User, Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'fk_tasks_users');
    });

    it('auto-generates from fk_{source_table}_{target_table} on hasOne', async () => {
      defineModels();
      User.hasOne(Profile, { foreignKey: 'userId' });

      await createSeq([User, Profile]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('profiles');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'fk_profiles_users');
    });

    it('uses explicit constraintName from references in attributes', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id', constraintName: 'custom_fk_name' } }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      await createSeq([_User, _Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'custom_fk_name');
    });

    it('auto-generates when references has no constraintName', async () => {
      class _User extends Model {}
      _User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class _Task extends Model {}
      _Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id' } }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      await createSeq([_User, _Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'fk_tasks_users');
    });

    it('rejects invalid FK with constraint info in schema', async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });

      await createSeq([User, Task]);
      await seq.sync();

      await assert.rejects(
        () => Task.create({ title: 'Bad task', userId: 999 })
      );
    });

    it('rejects delete of parent with RESTRICT', async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId' });

      await createSeq([User, Task]);
      await seq.sync();

      const user = await User.create({ name: 'Ana' });
      await Task.create({ title: 'Task 1', userId: user.getDataValue('id') });
      await assert.rejects(
        () => user.destroy()
      );
    });

    it('merges constraintName from hasMany when belongsTo is also declared', async () => {
      defineModels();
      User.hasMany(Task, { foreignKey: 'userId', constraintName: 'my_custom_fk' });
      Task.belongsTo(User, { foreignKey: 'userId' });

      await createSeq([User, Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      const fk = schema.foreignKeys.find(f => f.attributeName === 'userId');
      assert.equal(fk.constraintName, 'my_custom_fk');
    });
  });
});
