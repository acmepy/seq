import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Seq.sync', () => {
  let seq, adapter;
  let User;
  let Product;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'User', tableName: 'users', timestamps: true }
    );
    User = _User;

    class _Product extends Model {}
    _Product.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 }
      },
      { modelName: 'Product', tableName: 'products', timestamps: true }
    );
    Product = _Product;

    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({
      adapter,
      models: [User, Product],
      logging: false
    });
    await seq.init();
  });

  afterEach(async () => {
    await seq.close();
  });

  it('creates missing tables', async () => {
    const result = await seq.sync();
    assert.deepEqual(result.created.sort(), ['products', 'users']);
    assert.deepEqual(result.existing, []);
  });

  it('does not recreate existing tables without force', async () => {
    await seq.sync();
    const result = await seq.sync();
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.existing.sort(), ['products', 'users']);
  });

  it('registers schemas for existing SQLite tables after reopening', async () => {
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
    assert.deepEqual(result.dropped.sort(), ['products', 'users']);
    assert.deepEqual(result.created.sort(), ['products', 'users']);
  });

  it('recreates related tables with force: true after truncating data', async () => {
    class _Parent extends Model {}
    _Parent.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'Parent', tableName: 'parents', timestamps: false }
    );

    class _Child extends Model {}
    _Child.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        parentId: { type: DataTypes.INTEGER, allowNull: false }
      },
      { modelName: 'Child', tableName: 'children', timestamps: false }
    );

    _Parent.hasMany(_Child, { foreignKey: 'parentId' });
    _Child.belongsTo(_Parent, { foreignKey: 'parentId' });

    const relatedAdapter = new SQLiteAdapter({ database: ':memory:' });
    const relatedSeq = new Seq({
      adapter: relatedAdapter,
      models: [_Parent, _Child],
      logging: false
    });

    try {
      await relatedSeq.init();
      await relatedSeq.sync();
      const parent = await _Parent.create({ name: 'Ana' });
      await _Child.create({ parentId: parent.getDataValue('id') });

      const result = await relatedSeq.sync({ force: true });

      assert.deepEqual(result.dropped.sort(), ['children', 'parents']);
      assert.deepEqual(result.created.sort(), ['children', 'parents']);
    } finally {
      await relatedSeq.close();
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
      { modelName: 'Extra', tableName: 'extras', timestamps: false }
    );

    seq.registerModel(_Extra);
    _Extra.seq = seq;

    const result = await seq.sync({ alter: true });
    assert.ok(result.created.includes('extras'));
  });
});
