import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Unique Constraints', () => {
  let seq, adapter;
  let User;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
        username: { type: DataTypes.STRING(50), allowNull: false, unique: true }
      },
      { modelName: 'User', tableName: 'users' }
    );
    User = _User;

    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({
      adapter,
      models: [User],
      logging: false
    });
    await seq.init();
    await seq.sync();
  });

  afterEach(async () => {
    await seq.close();
  });

  describe('insert', () => {
    it('allows unique values', async () => {
      const user1 = await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      const user2 = await User.create({ name: 'Juan', email: 'juan@test.com', username: 'juan' });
      assert.ok(user1);
      assert.ok(user2);
    });

    it('rejects duplicate unique value', async () => {
      await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      await assert.rejects(
        () => User.create({ name: 'Juan', email: 'ana@test.com', username: 'juan' })
      );
    });

    it('allows multiple null values on unique column', async () => {
      class _NullUser extends Model {}
      _NullUser.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          nickname: { type: DataTypes.STRING(50), allowNull: true, unique: true }
        },
        { modelName: 'NullUser', tableName: 'null_users' }
      );

      seq = new Seq({
        adapter,
        models: [_NullUser],
        logging: false
      });
      await seq.init();
      await seq.sync();

      const user1 = await _NullUser.create({ name: 'Ana' });
      const user2 = await _NullUser.create({ name: 'Juan' });
      assert.ok(user1);
      assert.ok(user2);
    });

    it('rejects duplicate on second unique column', async () => {
      await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      await assert.rejects(
        () => User.create({ name: 'Juan', email: 'juan@test.com', username: 'ana' })
      );
    });
  });

  describe('update', () => {
    it('allows updating a unique column to a new value', async () => {
      const user = await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      await user.update({ email: 'ana2@test.com' });
      assert.equal(user.getDataValue('email'), 'ana2@test.com');
    });

    it('allows keeping the same unique value (self)', async () => {
      const user = await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      await user.update({ email: 'ana@test.com' });
      assert.equal(user.getDataValue('email'), 'ana@test.com');
    });

    it('rejects update that creates a duplicate', async () => {
      await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      const juan = await User.create({ name: 'Juan', email: 'juan@test.com', username: 'juan' });
      await assert.rejects(
        () => juan.update({ email: 'ana@test.com' })
      );
    });
  });

  describe('multiple unique columns', () => {
    it('enforces uniqueness independently on each column', async () => {
      await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });

      await assert.rejects(
        () => User.create({ name: 'Juan', email: 'ana@test.com', username: 'juan' })
      );

      await assert.rejects(
        () => User.create({ name: 'Juan', email: 'juan@test.com', username: 'ana' })
      );
    });
  });

  describe('bulk insert', () => {
    it('rejects bulk insert with duplicates', async () => {
      await User.create({ name: 'Ana', email: 'ana@test.com', username: 'ana' });
      await assert.rejects(
        () => seq._adapter.dml.bulkInsert(User, [
          { name: 'Juan', email: 'juan@test.com', username: 'juan' },
          { name: 'Pedro', email: 'ana@test.com', username: 'pedro' }
        ])
      );
    });
  });
});
