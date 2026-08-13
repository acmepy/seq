import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

describe('DDL Phases', () => {
  let seq;
  let context;

  async function initSeq(models) {
    context = await createTestContext({ models, logging: false });
    seq = context.seq;
    return seq;
  }

  function constraintTableName(tableName) {
    const prefix = seq._adapter.naming?.prefix;
    if (!prefix) return String(tableName);
    const token = String(prefix).endsWith('_') ? String(prefix) : `${prefix}_`;
    return String(tableName).replaceAll(token, '');
  }

  function expectedForeignKeyName(sourceTable, targetTable, foreignKeyColumn) {
    return `fk_${constraintTableName(sourceTable)}_${constraintTableName(targetTable)}_${foreignKeyColumn}`;
  }

  afterEach(async () => {
    await cleanupTestContext(context);
    context = null;
    seq = null;
  });

  describe('_buildTableDefinition grouping', () => {
    it('separates unique constraints from columns', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
          name: { type: DataTypes.STRING(100) }
        },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);

      const def = seq._buildTableDefinition(User);

      assert.ok(def.columns.email, 'email column exists');
      assert.equal(def.columns.email.unique, undefined, 'unique flag removed from column');
      assert.equal(def.uniqueConstraints.length, 1);
      assert.deepEqual(def.uniqueConstraints[0].columns, ['email']);
      assert.equal(def.uniqueConstraints[0].constraintName, `uk_${User.tableName}_email`);
    });

    it('includes indexes array (empty for now)', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100) }
        },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);

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
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);

      const def = seq._buildTableDefinition(User);
      assert.equal(def.uniqueConstraints.length, 2);
      const names = def.uniqueConstraints.map(uk => uk.constraintName);
      assert.ok(names.includes(`uk_${User.tableName}_email`));
      assert.ok(names.includes(`uk_${User.tableName}_username`));
    });

    it('columns retain no unique flag', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), unique: true }
        },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);

      const def = seq._buildTableDefinition(User);
      assert.equal(Object.keys(def.columns.email).includes('unique'), false);
    });

    it('excludes virtual attributes from physical columns', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          firstName: { type: DataTypes.STRING(100), allowNull: false },
          lastName: { type: DataTypes.STRING(100), allowNull: false },
          fullName: {
            type: DataTypes.VIRTUAL,
            get() {
              return `${this.getDataValue('firstName')} ${this.getDataValue('lastName')}`;
            }
          }
        },
        { modelName: 'User', tableName: testTable('users'), timestamps: false }
      );

      await initSeq([User]);

      const def = seq._buildTableDefinition(User);
      assert.ok(!def.columns.fullName);
      assert.ok(!def.attrToColumn.fullName);
      assert.ok(!def.columnToAttr.fullName);
      assert.deepEqual(def.virtualAttributes, ['fullName']);
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
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);
      await seq.sync();

      const schema = seq._adapter.schemas.get(User.tableName);
      assert.ok(Array.isArray(schema.uniqueConstraints));
      assert.ok(Array.isArray(schema.indexes));
      assert.ok(Array.isArray(schema.foreignKeys));
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, `uk_${User.tableName}_email`);
    });

    it('foreignKeys stored separately from createTable', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: testTable('users') }
      );

      class Task extends Model {}
      Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER }
        },
        { modelName: 'Task', tableName: testTable('tasks') }
      );

      User.hasMany(Task, { foreignKey: 'userId' });
      Task.belongsTo(User, { foreignKey: 'userId' });

      await initSeq([User, Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get(Task.tableName);
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, expectedForeignKeyName(Task.tableName, User.tableName, 'user_id'));
    });
  });

  describe('DDL methods', () => {
    it('addUniqueConstraint stores constraint on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, email: { type: DataTypes.STRING(150) } },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);
      await seq.sync();

      await seq._adapter.ddl.addUniqueConstraint(User.tableName, { columns: ['email'], constraintName: `uk_${User.tableName}_email` });
      const schema = seq._adapter.schemas.get(User.tableName);
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, `uk_${User.tableName}_email`);
    });

    it('addIndex stores index on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);
      await seq.sync();

      await seq._adapter.ddl.addIndex(User.tableName, { columns: ['name'], name: `idx_${User.tableName}_name`, unique: false });
      const schema = seq._adapter.schemas.get(User.tableName);
      assert.equal(schema.indexes.length, 1);
      assert.equal(schema.indexes[0].name, `idx_${User.tableName}_name`);
    });

    it('addForeignKey stores fk on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: testTable('users') }
      );

      class Task extends Model {}
      Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id' } }
        },
        { modelName: 'Task', tableName: testTable('tasks') }
      );

      await initSeq([User, Task]);
      await seq.sync();

      const schema = seq._adapter.schemas.get(Task.tableName);
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, expectedForeignKeyName(Task.tableName, User.tableName, 'user_id'));
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
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);
      await seq.sync();

      const schema1 = seq._adapter.schemas.get(User.tableName);
      assert.equal(schema1.uniqueConstraints.length, 0);

      const def = seq._buildTableDefinition(User);
      const changed = await seq._adapter.ddl.alterTable(User.tableName, def);
      assert.equal(changed, false);
    });

    // TODO: reactivar para tests de adapters que soporten ALTER TABLE ADD FK (Oracle, PostgreSQL, etc.)
    // SQLite no puede agregar FKs después de crear la tabla — las FKs solo se crean en createTableStructure (inline)
    // it('adds new foreign keys on alter', async () => {
    //   class User extends Model {}
    //   User.init(
    //     { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
    //     { modelName: 'User', tableName: 'users' }
    //   );
    //   class Task extends Model {}
    //   Task.init(
    //     {
    //       id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    //       title: { type: DataTypes.STRING(100) },
    //       userId: { type: DataTypes.INTEGER }
    //     },
    //     { modelName: 'Task', tableName: 'tasks' }
    //   );
    //   seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [User, Task], logging: false });
    //   await seq.init();
    //   await seq.sync();
    //   const schemaBefore = seq._adapter.schemas.get('tasks');
    //   assert.equal(schemaBefore.foreignKeys.length, 0);
    //   User.hasMany(Task, { foreignKey: 'userId' });
    //   Task.belongsTo(User, { foreignKey: 'userId' });
    //   const def = seq._buildTableDefinition(Task);
    //   const changed = await seq._adapter.ddl.alterTable('tasks', def);
    //   assert.equal(changed, true);
    //   const schemaAfter = seq._adapter.schemas.get('tasks');
    //   assert.equal(schemaAfter.foreignKeys.length, 1);
    //   assert.equal(schemaAfter.foreignKeys[0].constraintName, 'fk_tasks_users');
    // });
  });
});
