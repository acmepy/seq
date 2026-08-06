import { CacheAdapter } from './CacheAdapter.js';

export class MemcachedCacheAdapter extends CacheAdapter {
  constructor(options = {}) {
    super(options);
    // this._memcached = options.memcachedClient;
  }

  async get(key) {
    throw new Error('MemcachedCacheAdapter is not fully implemented');
  }

  async set(key, value, modelName, ttl) {
    throw new Error('MemcachedCacheAdapter is not fully implemented');
  }

  async delete(key) {
    throw new Error('MemcachedCacheAdapter is not fully implemented');
  }

  async invalidate(modelName) {
    // Implementar estrategia de versionado por modelo
    throw new Error('MemcachedCacheAdapter is not fully implemented');
  }

  async clear() {
    throw new Error('MemcachedCacheAdapter is not fully implemented');
  }
}
