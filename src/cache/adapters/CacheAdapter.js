export class CacheAdapter {
  constructor(options = {}) {
    this.options = options;
    this._seq = null; // Will be injected by Cache if needed
  }

  /**
   * Gets a value from cache
   * @param {string} key
   * @returns {Promise<{ hit: boolean, value?: any }>}
   */
  async get(key) {
    throw new Error('Not implemented');
  }

  /**
   * Sets a value in cache
   * @param {string} key
   * @param {*} value
   * @param {string} modelName
   * @param {number} ttl
   * @returns {Promise<void>}
   */
  async set(key, value, modelName, ttl) {
    throw new Error('Not implemented');
  }

  /**
   * Deletes a specific key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    throw new Error('Not implemented');
  }

  /**
   * Invalidates all cache entries for a given model
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async invalidate(modelName) {
    throw new Error('Not implemented');
  }

  /**
   * Clears all cache
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('Not implemented');
  }
}
