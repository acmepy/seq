import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, Model } from '../../src/index.js';

export function runAdapterSuite({ name, createSeq, cleanup = async () => {}, supports = {} }) {
  describe(`[adapter] ${name}`, () => {
    let context = null;
    let counter = 0;
    const prefix = 'adt';
    const baseAliases = {
      auth_users: 'au',
      sync_users: 'su',
      sync_products: 'sp',
      force_users: 'fu',
      crud_users: 'cu',
      unique_users: 'uu',
      include_users: 'iu',
      include_tasks: 'it',
      tx_users: 'tu'
    };

    function tableName(base) {
      return `${prefix}_${counter}_${baseAliases[base] || base}`;
    }

    function physicalTableName(model) {
      return model._resolvedTableName || model.tableName;
    }

    async function setup(models) {
      context = await createSeq({ models });
      await context.seq.init();
      return context;
    }

    function isConstraintError(error, type) {
      return error?.details?.constraint?.type === type;
    }

    afterEach(async () => {
      if (!context) return;
      try {
        await cleanup(context);
      } finally {
        await context.seq.close();
        context = null;
      }
    });

    it('[adapter] authenticates and syncs models', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterAuthUser${counter}`, tableName: tableName('auth_users'), timestamps: false }
      );

      context = await createSeq({ models: [User] });
      assert.equal(await context.seq.authenticate(), true);
      const result = await context.seq.sync();

      assert.ok(result.created.includes(physicalTableName(User)) || result.existing.includes(physicalTableName(User)));
      assert.equal(await context.adapter.ddl.hasTable(physicalTableName(User)), true);
    });

    it('[adapter] creates missing tables and detects existing tables', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterSyncUser${counter}`, tableName: tableName('sync_users'), timestamps: false }
      );

      class Product extends Model {}
      Product.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterSyncProduct${counter}`, tableName: tableName('sync_products'), timestamps: false }
      );

      const { seq } = await setup([User, Product]);
      const created = await seq.sync();
      const existing = await seq.sync();

      assert.deepEqual(created.created.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
      assert.deepEqual(existing.existing.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
    });

    it('[adapter] recreates tables with force sync', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterForceUser${counter}`, tableName: tableName('force_users'), timestamps: false }
      );

      const { seq } = await setup([User]);
      await seq.sync();
      await User.create({ name: 'Ana' });

      const result = await seq.sync({ force: true });

      assert.ok(result.dropped.includes(physicalTableName(User)));
      assert.ok(result.created.includes(physicalTableName(User)));
      assert.equal(await User.count(), 0);
    });

    it('[adapter] runs CRUD with timestamps, booleans and JSON', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(150), allowNull: false },
          active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          meta: { type: DataTypes.JSON }
        },
        { modelName: `AdapterCrudUser${counter}`, tableName: tableName('crud_users'), timestamps: true }
      );

      const { seq } = await setup([User]);
      await seq.sync();

      const created = await User.create({
        name: 'Ana',
        email: 'ana@test.com',
        meta: { role: 'admin' }
      });
      assert.ok(created.getDataValue('id'));
      assert.ok(created.getDataValue('createdAt') instanceof Date);
      assert.ok(created.getDataValue('updatedAt') instanceof Date);
      assert.equal(created.getDataValue('active'), true);

      const found = await User.findByPk(created.getDataValue('id'));
      assert.equal(found.getDataValue('name'), 'Ana');
      assert.deepEqual(found.getDataValue('meta'), { role: 'admin' });

      await found.update({ name: 'Ana Maria' });
      assert.equal((await User.findOne({ where: { email: 'ana@test.com' } })).getDataValue('name'), 'Ana Maria');

      await found.destroy();
      assert.equal(await User.count(), 0);
    });

    it('[adapter] enforces unique constraints', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(150), unique: true }
        },
        { modelName: `AdapterUniqueUser${counter}`, tableName: tableName('unique_users'), timestamps: false }
      );

      const { seq } = await setup([User]);
      await seq.sync();
      await User.create({ email: 'ana@test.com' });

      await assert.rejects(
        () => User.create({ email: 'ana@test.com' }),
        error => isConstraintError(error, 'unique')
      );
    });

    it('[adapter] enforces foreign keys and loads basic includes', async () => {
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterIncludeUser${counter}`, tableName: tableName('include_users'), timestamps: false }
      );

      class Task extends Model {}
      Task.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100), allowNull: false },
          userId: { type: DataTypes.INTEGER, allowNull: false }
        },
        { modelName: `AdapterIncludeTask${counter}`, tableName: tableName('include_tasks'), timestamps: false }
      );

      User.hasMany(Task, { foreignKey: 'userId', as: 'tasks', onDelete: 'CASCADE' });
      Task.belongsTo(User, { foreignKey: 'userId', as: 'user' });

      const { seq } = await setup([User, Task]);
      await seq.sync();

      await assert.rejects(
        () => Task.create({ title: 'orphan', userId: 999999 }),
        error => isConstraintError(error, 'foreignKey')
      );

      const user = await User.create({ name: 'Ana' });
      await Task.create({ title: 'Ship adapters', userId: user.getDataValue('id') });

      const rows = await User.findAll({ include: [Task] });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].getDataValue('tasks').length, 1);
      assert.equal(rows[0].getDataValue('tasks')[0].getDataValue('title'), 'Ship adapters');
    });

    it('[adapter] commits and rolls back transactions', async () => {
      if (supports.transactions === false) return;
      counter++;
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: `AdapterTxUser${counter}`, tableName: tableName('tx_users'), timestamps: false }
      );

      const { seq } = await setup([User]);
      await seq.sync();

      await seq.transaction(async transaction => {
        await User.create({ name: 'Commit' }, { transaction });
      });
      assert.equal(await User.count(), 1);

      await assert.rejects(
        () => seq.transaction(async transaction => {
          await User.create({ name: 'Rollback' }, { transaction });
          throw new Error('rollback');
        }),
        /rollback/
      );
      assert.equal(await User.count(), 1);
    });
  });
}
