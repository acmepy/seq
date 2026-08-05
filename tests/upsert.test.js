import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

describe('Model upsert', () => {
  function defineUser() {
    class User extends Model {}
    User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
      },
      { modelName: 'User', tableName: 'users', timestamps: true }
    );
    return User;
  }

  describe('SQLiteAdapter', () => {
    let seq;
    let User;
    let trace;

    beforeEach(async () => {
      trace = [];
      User = defineUser();
      const adapter = new SQLiteAdapter({ database: ':memory:' });
      await adapter.connect();
      seq = new Seq({
        adapter,
        models: [User],
        logging: { trace: (...args) => trace.push(args), info: false, warn: false, error: false }
      });
      await seq.init();
      await seq.sync();
      trace = [];
    });

    afterEach(async () => {
      await seq.close();
    });

    it('inserts when no matching row exists', async () => {
      const [user, created] = await User.upsert(
        { email: 'ana@test.com', name: 'Ana' },
        { conflictFields: ['email'] }
      );

      assert.equal(created, true);
      assert.equal(user.getDataValue('email'), 'ana@test.com');
      assert.equal(await User.count(), 1);
    });
/*
    it('updates using native SQLite ON CONFLICT for unique fields', async () => {
      const [createdUser] = await User.upsert(
        { email: 'ana@test.com', name: 'Ana' },
        { conflictFields: ['email'] }
      );

      const [updatedUser, created] = await User.upsert(
        { email: 'ana@test.com', name: 'Ana Maria' },
        { conflictFields: ['email'] }
      );

      assert.equal(created, false);
      assert.equal(updatedUser.getDataValue('id'), createdUser.getDataValue('id'));
      assert.equal(updatedUser.getDataValue('name'), 'Ana Maria');
      assert.equal(await User.count(), 1);
      assert.ok(trace.some(args => String(args[1]).includes('ON CONFLICT')));
    });
*/
    it('falls back to select and update for arbitrary where clauses', async () => {
      const user = await User.create({ email: 'ana@test.com', name: 'Ana' });
      const [updatedUser, created] = await User.upsert(
        { name: 'Ana Fallback' },
        { where: { email: 'ana@test.com' } }
      );

      assert.equal(created, false);
      assert.equal(updatedUser.getDataValue('id'), user.getDataValue('id'));
      assert.equal(updatedUser.getDataValue('name'), 'Ana Fallback');
    });

    it('runs upsert hooks and allows beforeUpsert to change values', async () => {
      const calls = [];

      User.addHook('beforeUpsert', (values, options) => {
        calls.push(`beforeUpsert:${options.conflictFields.join(',')}`);
        values.email = values.email.trim().toLowerCase();
        values.name = values.name.toUpperCase();
      });
      User.addHook('afterUpsert', ([user, created], options) => {
        calls.push(`afterUpsert:${created}:${options.conflictFields.join(',')}:${user.getDataValue('name')}`);
      });

      const [user, created] = await User.upsert(
        { email: ' ANA@TEST.COM ', name: 'Ana' },
        { conflictFields: ['email'] }
      );

      assert.equal(created, true);
      assert.equal(user.getDataValue('email'), 'ana@test.com');
      assert.equal(user.getDataValue('name'), 'ANA');
      assert.deepEqual(calls, ['beforeUpsert:email', 'afterUpsert:true:email:ANA']);
    });
  });

  describe('MapAdapter fallback', () => {
    let seq;
    let User;

    beforeEach(async () => {
      User = defineUser();
      const adapter = new MapAdapter();
      seq = new Seq({ adapter, models: [User], logging: false });
      await seq.init();
      await seq.sync();
    });

    afterEach(async () => {
      await seq.close();
    });

    it('delegates to the adapter fallback implementation', async () => {
      const [inserted, insertedCreated] = await User.upsert(
        { email: 'ana@test.com', name: 'Ana' },
        { conflictFields: ['email'] }
      );
      const [updated, updatedCreated] = await User.upsert(
        { email: 'ana@test.com', name: 'Ana Map' },
        { conflictFields: ['email'] }
      );

      assert.equal(insertedCreated, true);
      assert.equal(updatedCreated, false);
      assert.equal(updated.getDataValue('id'), inserted.getDataValue('id'));
      assert.equal(updated.getDataValue('name'), 'Ana Map');
      assert.equal(await User.count(), 1);
    });
  });

  it('rejects calls without a target', async () => {
    const User = defineUser();
    const adapter = new MapAdapter();
    const seq = new Seq({ adapter, models: [User], logging: false });
    await seq.init();
    await seq.sync();

    await assert.rejects(
      () => User.upsert({ name: 'Ana' }),
      error => error.code === 'SEQ_VALIDATION_UPSERT_TARGET'
    );

    await seq.close();
  });
});
