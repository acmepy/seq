import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { cleanupTestContext, createTestContext, testAdapterName, testTable } from './shared/test-context.js';

function physicalTableName(model) {
  return model._resolvedTableName || model.tableName;
}

describe('Seq.sync', () => {
  let seq, adapter;
  let context;
  let User;
  let Product;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'User', tableName: testTable('users'), timestamps: true }
    );
    User = _User;

    class _Product extends Model {}
    _Product.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 }
      },
      { modelName: 'Product', tableName: testTable('products'), timestamps: true }
    );
    Product = _Product;

    context = await createTestContext({ models: [User, Product], logging: false });
    ({ seq, adapter } = context);
  });

  afterEach(async () => {
    await cleanupTestContext(context);
    context = null;
    seq = null;
    adapter = null;
  });

  it('creates missing tables', async () => {
    const result = await seq.sync();
    assert.deepEqual(result.created.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
    assert.deepEqual(result.existing, []);
  });

  it('does not recreate existing tables without force', async () => {
    await seq.sync();
    const result = await seq.sync();
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.existing.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
  });

  it('registers schemas for existing SQLite tables after reopening', async () => {
    if (testAdapterName() !== 'sqlite') return;

    const database = join(tmpdir(), `seq-reopen-${process.pid}-${Date.now()}.sqlite`);

    class _Permission extends Model {}
    _Permission.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        permission: { type: DataTypes.STRING(150), allowNull: false },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
      },
      { modelName: 'Permission', timestamps: true }
    );

    let firstSeq = new Seq({
      adapter: new SQLiteAdapter({ database }),
      models: [_Permission],
      logging: false
    });

    try {
      await firstSeq.init();
      await firstSeq.sync();
      await _Permission.create({ permission: 'users.list', active: true });
      await firstSeq.close();
      firstSeq = null;

      class _ReopenedPermission extends Model {}
      _ReopenedPermission.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          permission: { type: DataTypes.STRING(150), allowNull: false },
          active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
        },
        { modelName: 'Permission', timestamps: true }
      );

      const reopenedSeq = new Seq({
        adapter: new SQLiteAdapter({ database }),
        models: [_ReopenedPermission],
        logging: false
      });

      try {
        await reopenedSeq.init();
        assert.equal(await _ReopenedPermission.count(), 1);

        const result = await reopenedSeq.sync();

        assert.deepEqual(result.created, []);
        assert.deepEqual(result.existing, ['permission']);
      } finally {
        await reopenedSeq.close();
      }
    } finally {
      if (firstSeq) await firstSeq.close();
      await rm(database, { force: true });
      await rm(`${database}-shm`, { force: true });
      await rm(`${database}-wal`, { force: true });
    }
  });

  it('recreates tables with force: true', async () => {
    await seq.sync();
    const result = await seq.sync({ force: true });
    assert.deepEqual(result.dropped.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
    assert.deepEqual(result.created.sort(), [physicalTableName(Product), physicalTableName(User)].sort());
  });

  it('recreates related tables with force: true after truncating data', async () => {
    class _Parent extends Model {}
    _Parent.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'Parent', tableName: testTable('parents'), timestamps: false }
    );

    class _Child extends Model {}
    _Child.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        parentId: { type: DataTypes.INTEGER, allowNull: false }
      },
      { modelName: 'Child', tableName: testTable('children'), timestamps: false }
    );

    _Parent.hasMany(_Child, { foreignKey: 'parentId' });
    _Child.belongsTo(_Parent, { foreignKey: 'parentId' });

    const relatedContext = await createTestContext({ models: [_Parent, _Child], logging: false });

    try {
      await relatedContext.seq.sync();
      const parent = await _Parent.create({ name: 'Ana' });
      await _Child.create({ parentId: parent.getDataValue('id') });

      const result = await relatedContext.seq.sync({ force: true });

      assert.deepEqual(result.dropped.sort(), [physicalTableName(_Child), physicalTableName(_Parent)].sort());
      assert.deepEqual(result.created.sort(), [physicalTableName(_Child), physicalTableName(_Parent)].sort());
    } finally {
      await cleanupTestContext(relatedContext);
    }
  });

  it('detects altered columns with alter: true', async () => {
    await seq.sync();
    class _Extra extends Model {}
    _Extra.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100) },
        extra: { type: DataTypes.STRING(50) }
      },
      { modelName: 'Extra', tableName: testTable('extras'), timestamps: false }
    );

    seq.registerModel(_Extra);
    _Extra.seq = seq;

    const result = await seq.sync({ alter: true });
    assert.ok(result.created.includes(physicalTableName(_Extra)));
  });
});
