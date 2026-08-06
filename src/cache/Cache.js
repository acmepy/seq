import { MapCacheAdapter } from './adapters/MapCacheAdapter.js';
import { generateCacheKey } from './utils.js';

export class Cache {
  constructor(options = {}) {
    this.options = options;
    this.globalTtl = options.ttl || 60 * 1000;

    if (options.adapter) {
      this.adapter = options.adapter;
    } else {
      this.adapter = new MapCacheAdapter(options);
    }
  }

  /**
   * Internal logging function delegating to Seq
   * @param {...*} args
   */
  _log(...args) {
    if (this.seq && typeof this.seq._log === 'function') {
      this.seq._log(...args);
    }
  }

  /**
   * Checks if cache is enabled for a specific model
   * @param {string} modelName
   * @returns {boolean}
   */
  isEnabled(modelName) {
    if (this.options[modelName] === false) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the TTL for a given model
   * @param {string} modelName
   * @returns {number}
   */
  _resolveTtl(modelName) {
    const modelOptions = this.options[modelName];
    if (modelOptions && typeof modelOptions === 'object' && modelOptions.ttl !== undefined) {
      return modelOptions.ttl;
    }
    return this.globalTtl;
  }

  /**
   * Gets a value from the cache
   * @param {string} modelName
   * @param {string} operation
   * @param {object} queryOptions
   * @returns {Promise<{ hit: boolean, value?: any }>}
   */
  async get(modelName, operation, queryOptions) {
    if (!this.isEnabled(modelName)) return { hit: false };
    const key = generateCacheKey(modelName, operation, queryOptions);
    const result = await this.adapter.get(key);
    this._log('trace', `Cache ${result.hit?'hit':'miss'}: ${key}, model: ${modelName}`);
    return result;
  }

  /**
   * Sets a value in the cache
   * @param {string} modelName
   * @param {string} operation
   * @param {object} queryOptions
   * @param {*} value
   * @returns {Promise<void>}
   */
  async set(modelName, operation, queryOptions, value) {
    if (!this.isEnabled(modelName)) return;
    const key = generateCacheKey(modelName, operation, queryOptions);
    const ttl = this._resolveTtl(modelName);
    await this.adapter.set(key, value, modelName, ttl);
  }

  /**
   * Invalidates the cache for a model
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async invalidate(modelName) {
    await this.adapter.invalidate(modelName);
  }

  /**
   * Clears all cache
   * @returns {Promise<void>}
   */
  async clear() {
    await this.adapter.clear();
  }
}
