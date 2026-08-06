import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { MapCacheAdapter } from '../src/cache/adapters/MapCacheAdapter.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

class User extends Model {}

describe('Cache System Integration', () => {
  let seq;
  let cacheMisses = 0;
  
  beforeEach(async () => {
    cacheMisses = 0;

    // Use a custom memory adapter or existing one to track queries
    const adapter = new MapAdapter();
    const originalSelectAll = adapter.dml.selectAll.bind(adapter.dml);
    adapter.dml.selectAll = async (...args) => {
      cacheMisses++;
      return originalSelectAll(...args);
    };

    const originalCount = adapter.dml.count.bind(adapter.dml);
    adapter.dml.count = async (...args) => {
      cacheMisses++;
      return originalCount(...args);
    };

    seq = new Seq({
      adapter,
      cache: {
        ttl: 60000,
        users: { ttl: 5000 },
        roles: false
      },
      models: [User]
    });

    User.init({
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
      active: { type: DataTypes.BOOLEAN }
    }, { seq, modelName: 'users' });

    await seq.init();
    await seq.sync({ force: true });
  });

  afterEach(async () => {
    await seq.close();
  });

  test('findAll cache hit', async () => {
    await User.create({ name: 'Alice' });
    
    cacheMisses = 0;
    const users1 = await User.findAll();
    assert.strictEqual(cacheMisses, 1);
    
    const users2 = await User.findAll();
    assert.strictEqual(cacheMisses, 1); // Hit cache!
    
    assert.deepStrictEqual(users1.map(u => u.id), users2.map(u => u.id));
  });

  test('findOne and findByPk cache', async () => {
    const user = await User.create({ id: 99, name: 'Bob' });
    
    cacheMisses = 0;
    await User.findOne({ where: { id: 99 } });
    assert.strictEqual(cacheMisses, 1);
    
    await User.findOne({ where: { id: 99 } });
    assert.strictEqual(cacheMisses, 1); // Hit cache!

    // findByPk uses findOne under the hood, but different options initially
    await User.findByPk(99);
    assert.strictEqual(cacheMisses, 1); // Hit cache!
    
    await User.findByPk(99);
    assert.strictEqual(cacheMisses, 1); // Hit cache!
  });

  test('count cache', async () => {
    await User.create({ name: 'Charlie' });
    
    cacheMisses = 0;
    const count1 = await User.count();
    assert.strictEqual(cacheMisses, 1);
    
    const count2 = await User.count();
    assert.strictEqual(cacheMisses, 1); // Hit cache!
    assert.strictEqual(count1, count2);
  });

  test('cache: false ignores cache', async () => {
    await User.create({ name: 'Dave' });
    
    cacheMisses = 0;
    await User.findAll({ cache: false });
    assert.strictEqual(cacheMisses, 1);
    
    await User.findAll({ cache: false });
    assert.strictEqual(cacheMisses, 2); // Bypassed cache!
  });

  test('TTL configuration', async () => {
    // We can inspect the map to see TTL
    const adapter = seq.cache.adapter;
    await User.findAll();
    const entry = Array.from(adapter._map.values())[0];
    
    // User model TTL is 5000
    const ttlSet = entry.expiresAt - Date.now();
    assert.ok(ttlSet <= 5000 && ttlSet > 4900);
  });

  test('model with cache: false', async () => {
    class Role extends Model {}
    Role.init({
      id: { type: DataTypes.INTEGER, primaryKey: true }
    }, { seq, modelName: 'roles' });
    seq.registerModel(Role);
    await seq.sync();

    cacheMisses = 0;
    await Role.findAll();
    assert.strictEqual(cacheMisses, 1);
    
    await Role.findAll();
    assert.strictEqual(cacheMisses, 2); // Miss because roles cache is false
  });

  test('automatic invalidation after mutations', async () => {
    await User.create({ name: 'Eve' });
    
    cacheMisses = 0;
    await User.findAll();
    assert.strictEqual(cacheMisses, 1);

    // Create invalidates
    await User.create({ name: 'Frank' });
    await User.findAll();
    assert.strictEqual(cacheMisses, 2); // Miss, invalidated

    // Update invalidates
    await User.findAll();
    assert.strictEqual(cacheMisses, 2); // Hit
    
    await User.update({ name: 'Frank2' }, { where: { name: 'Frank' } });
    await User.findAll();
    assert.strictEqual(cacheMisses, 3); // Miss, invalidated

    // Destroy invalidates
    await User.findAll();
    assert.strictEqual(cacheMisses, 3); // Hit
    
    await User.destroy({ where: { name: 'Eve' } });
    await User.findAll();
    assert.strictEqual(cacheMisses, 4); // Miss, invalidated
  });

  test('stable hash independent of property order', async () => {
    await User.findAll({ where: { active: true, name: 'Alice' } });
    const keys1 = Array.from(seq.cache.adapter._map.keys());
    
    await User.findAll({ where: { name: 'Alice', active: true } });
    const keys2 = Array.from(seq.cache.adapter._map.keys());

    // Both queries should produce the same cache key
    assert.deepStrictEqual(keys1, keys2);
    assert.strictEqual(keys1.length, 1);
  });

  test('transactions do not read from cache and invalidate after commit', async () => {
    await User.create({ name: 'Grace' });
    await User.findAll(); // cache the result
    
    cacheMisses = 0;
    
    await seq.transaction(async (transaction) => {
      // should miss inside tx
      await User.findAll({ transaction });
      assert.strictEqual(cacheMisses, 1);
      
      await User.create({ name: 'Heidi' }, { transaction });
    });

    // After commit, cache must be invalidated
    await User.findAll();
    assert.strictEqual(cacheMisses, 2); // Miss because it was invalidated by the commit
  });

  test('transactions do not invalidate on rollback', async () => {
    await User.create({ name: 'Ivan' });
    await User.findAll(); // cache it
    
    cacheMisses = 0;
    try {
      await seq.transaction(async (transaction) => {
        await User.create({ name: 'Judy' }, { transaction });
        throw new Error('rollback');
      });
    } catch (e) {
      // expected
    }

    // Cache should still be valid
    await User.findAll();
    assert.strictEqual(cacheMisses, 0); // Hit!
  });

  test('Map physically removes expired entries', async () => {
    const adapter = seq.cache.adapter;
    await adapter.set('testkey', 'val', 'users', -1000); // Expired 1 second ago
    
    assert.strictEqual(adapter._map.has('testkey'), true);
    const result = await adapter.get('testkey');
    assert.strictEqual(result.hit, false);
    assert.strictEqual(adapter._map.has('testkey'), false);
  });
});
