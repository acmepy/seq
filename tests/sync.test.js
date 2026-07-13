import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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

  it('recreates tables with force: true', async () => {
    await seq.sync();
    const result = await seq.sync({ force: true });
    assert.deepEqual(result.dropped.sort(), ['products', 'users']);
    assert.deepEqual(result.created.sort(), ['products', 'users']);
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
