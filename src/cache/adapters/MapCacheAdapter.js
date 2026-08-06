import { CacheAdapter } from './CacheAdapter.js';

export class MapCacheAdapter extends CacheAdapter {
  constructor(options = {}) {
    super(options);
    this._map = new Map();
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return { hit: false };
    if (Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  async set(key, value, modelName, ttl) {
    this._map.set(key, { value, expiresAt: Date.now() + ttl, model: modelName });
  }

  async delete(key) {
    this._map.delete(key);
  }

  async invalidate(modelName) {
    for (const [key, entry] of this._map.entries()) {
      if (entry.model === modelName) this._map.delete(key);
    }
  }

  async clear() {
    this._map.clear();
  }
}
