import { CacheAdapter } from './CacheAdapter.js';

export class RedisCacheAdapter extends CacheAdapter {
  constructor(options = {}) {
    super(options);
    // this._redis = options.redisClient;
  }

  async get(key) {
    // Esqueleto: Usar GET de Redis
    // return { hit: true, value: JSON.parse(await this._redis.get(key)) };
    throw new Error('RedisCacheAdapter is not fully implemented');
  }

  async set(key, value, modelName, ttl) {
    // Esqueleto: Usar SET con EX de Redis
    // await this._redis.set(key, JSON.stringify(value), 'EX', Math.ceil(ttl / 1000));
    throw new Error('RedisCacheAdapter is not fully implemented');
  }

  async delete(key) {
    // Esqueleto: Usar DEL
    // await this._redis.del(key);
    throw new Error('RedisCacheAdapter is not fully implemented');
  }

  async invalidate(modelName) {
    // Para Redis se debe implementar lógica de versionado:
    // seq:modelName:version
    // Incrementar versión en invalidate
    throw new Error('RedisCacheAdapter is not fully implemented');
  }

  async clear() {
    // await this._redis.flushdb();
    throw new Error('RedisCacheAdapter is not fully implemented');
  }
}
