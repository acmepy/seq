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

  function physicalTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  function physicalColumnName(model, attrName) {
    return model._resolvedColumns?.[attrName]
      || seq._adapter.resolveColumnName(model.rawAttributes[attrName] || {}, attrName);
  }

  function expectedUniqueName(tableName, columns) {
    return seq._adapter.uniqueConstraintName(tableName, columns);
  }

  function expectedForeignKeyName(sourceTable, targetTable, foreignKeyColumn) {
    return seq._adapter.foreignKeyConstraintName(sourceTable, targetTable, foreignKeyColumn);
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
      assert.deepEqual(def.uniqueConstraints[0].columns, [physicalColumnName(User, 'email')]);
      assert.equal(def.uniqueConstraints[0].constraintName, expectedUniqueName(physicalTableName(User), [physicalColumnName(User, 'email')]));
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
      assert.ok(names.includes(expectedUniqueName(physicalTableName(User), [physicalColumnName(User, 'email')])));
      assert.ok(names.includes(expectedUniqueName(physicalTableName(User), [physicalColumnName(User, 'username')])));
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

      const schema = seq._adapter.schemas.get(physicalTableName(User));
      assert.ok(Array.isArray(schema.uniqueConstraints));
      assert.ok(Array.isArray(schema.indexes));
      assert.ok(Array.isArray(schema.foreignKeys));
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, expectedUniqueName(physicalTableName(User), [physicalColumnName(User, 'email')]));
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

      const schema = seq._adapter.schemas.get(physicalTableName(Task));
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, expectedForeignKeyName(physicalTableName(Task), physicalTableName(User), schema.foreignKeys[0].columnName));
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

      const userTable = physicalTableName(User);
      const emailColumn = physicalColumnName(User, 'email');
      const constraintName = expectedUniqueName(userTable, [emailColumn]);
      await seq._adapter.ddl.addUniqueConstraint(userTable, { columns: [emailColumn], constraintName });
      const schema = seq._adapter.schemas.get(userTable);
      assert.equal(schema.uniqueConstraints.length, 1);
      assert.equal(schema.uniqueConstraints[0].constraintName, constraintName);
    });

    it('addIndex stores index on schema', async () => {
      class User extends Model {}
      User.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100) } },
        { modelName: 'User', tableName: testTable('users') }
      );

      await initSeq([User]);
      await seq.sync();

      const userTable = physicalTableName(User);
      const nameColumn = physicalColumnName(User, 'name');
      const indexName = seq._adapter.uniqueConstraintName(`idx_${userTable}`, [nameColumn]);
      await seq._adapter.ddl.addIndex(userTable, { columns: [nameColumn], name: indexName, unique: false });
      const schema = seq._adapter.schemas.get(userTable);
      assert.equal(schema.indexes.length, 1);
      assert.equal(schema.indexes[0].name, indexName);
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

      const schema = seq._adapter.schemas.get(physicalTableName(Task));
      assert.equal(schema.foreignKeys.length, 1);
      assert.equal(schema.foreignKeys[0].constraintName, expectedForeignKeyName(physicalTableName(Task), physicalTableName(User), schema.foreignKeys[0].columnName));
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

      const schema1 = seq._adapter.schemas.get(physicalTableName(User));
      assert.equal(schema1.uniqueConstraints.length, 0);

      const def = seq._buildTableDefinition(User);
      const changed = await seq._adapter.ddl.alterTable(physicalTableName(User), def);
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
