import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('DDL Phases', () => {
  let seq;

  describe('_buildTableDefinition grouping', () => {
    it('separates unique constraints from columns', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
          name: { type: DataTypes.STRING(100) }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();

      const def = seq._buildTableDefinition(User);

      assert.ok(def.columns.email, 'email column exists');
      assert.equal(def.columns.email.unique, undefined, 'unique flag removed from column');
      assert.equal(def.uniqueConstraints.length, 1);
      assert.deepEqual(def.uniqueConstraints[0].columns, ['email']);
      assert.equal(def.uniqueConstraints[0].constraintName, 'uk_users_email');
    });

    it('includes indexes array (empty for now)', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100) }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.ok(Array.isArray(def.indexes));
      assert.equal(def.indexes.length, 0);
    });

    it('generates multiple unique constraints', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), unique: true },
          username: { type: DataTypes.STRING(50), unique: true }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.uniqueConstraints.length, 2);
      const names = def.uniqueConstraints.map(uk => uk.constraintName);
      assert.ok(names.includes('uk_users_email'));
      assert.ok(names.includes('uk_users_username'));
    });

    it('columns retain no unique flag', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), unique: true }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(Object.keys(def.columns.email).includes('unique'), false);
    });
  });

  describe('schema storage', () => {
    it('schema has uniqueConstraints, indexes, foreignKeys arrays', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), unique: true }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();
      await seq.sync();

      const schema = seq._adapter.schemas.get('users');
      assert.ok(Array.isArray(schema.uniqueConstraints));
      assert.ok(Array.isArray(schema.indexes));
      assert.ok(Array.isArray(schema.foreignKeys));
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, 'uk_users_email');
    });

    it('foreignKeys stored separately from createTable', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class Task extends Model {}
      Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      User.hasMany(Task, { foreignKey: 'userId' });
      Task.belongsTo(User, { foreignKey: 'userId' });

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User, Task], logging: false });
      await seq.init();
      await seq.sync();

      const schema = seq._adapter.schemas.get('tasks');
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, 'fk_tasks_users');
    });
  });

  describe('DDL methods', () => {
    it('addUniqueConstraint stores constraint on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, email: { type: DataTypes.STRING(150) } },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();
      await seq.sync();

      await seq._adapter.ddl.addUniqueConstraint('users', { columns: ['email'], constraintName: 'uk_users_email' });
      const schema = seq._adapter.schemas.get('users');
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, 'uk_users_email');
    });

    it('addIndex stores index on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();
      await seq.sync();

      await seq._adapter.ddl.addIndex('users', { columns: ['name'], name: 'idx_users_name', unique: false });
      const schema = seq._adapter.schemas.get('users');
      assert.equal(schema.indexes.length, 1);
      assert.equal(schema.indexes[0].name, 'idx_users_name');
    });

    it('addForeignKey stores fk on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();
      await seq.sync();

      const fk = { attributeName: 'userId', columnName: 'user_id', constraintName: 'fk_tasks_users', references: { model: 'User', table: 'users', key: 'id', column: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' };
      await seq._adapter.ddl.addForeignKey('users', fk);
      const schema = seq._adapter.schemas.get('users');
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, 'fk_tasks_users');
    });
  });

  describe('alterTable with constraints', () => {
    it('adds missing unique constraints on alter', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150) }
        },
        { modelName: 'User', tableName: 'users' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User], logging: false });
      await seq.init();
      await seq.sync();

      const schema1 = seq._adapter.schemas.get('users');
      assert.equal(schema1.uniqueConstraints.length, 0);

      const def = seq._buildTableDefinition(User);
      const changed = await seq._adapter.ddl.alterTable('users', def);
      assert.equal(changed, false);
    });

    it('adds new foreign keys on alter', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: 'users' }
      );

      class Task extends Model {}
      Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER }
        },
        { modelName: 'Task', tableName: 'tasks' }
      );

      seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User, Task], logging: false });
      await seq.init();
      await seq.sync();

      const schemaBefore = seq._adapter.schemas.get('tasks');
      assert.equal(schemaBefore.foreignKeys.length, 0);

      User.hasMany(Task, { foreignKey: 'userId' });
      Task.belongsTo(User, { foreignKey: 'userId' });

      const def = seq._buildTableDefinition(Task);
      const changed = await seq._adapter.ddl.alterTable('tasks', def);
      assert.equal(changed, true);

      const schemaAfter = seq._adapter.schemas.get('tasks');
      assert.equal(schemaAfter.foreignKeys.length, 1);
      assert.equal(schemaAfter.foreignKeys[0].constraintName, 'fk_tasks_users');
    });
  });
});
