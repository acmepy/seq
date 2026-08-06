import crypto from 'crypto';

/**
 * Creates a stable string representation of an object by sorting its keys.
 * @param {*} obj
 * @returns {string}
 */
export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  let result = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (obj[key] !== undefined) {
      result += JSON.stringify(key) + ':' + stableStringify(obj[key]);
      if (i < keys.length - 1) result += ',';
    }
  }
  if (result.endsWith(',')) result = result.slice(0, -1);
  result += '}';
  return result;
}

/**
 * Generates a deterministic hash for cache keys.
 * @param {string} modelName
 * @param {string} operation
 * @param {object} options
 * @returns {string}
 */
export function generateCacheKey(modelName, operation, options = {}) {
  // Filter out options that don't affect the SQL result
  const { cache, transaction, hooks, _isNew, _partial, ...cacheableOptions } = options;
  const serializedOptions = stableStringify(cacheableOptions);
  //const hash = crypto.createHash('sha256').update(serializedOptions).digest('hex');
  const hash = crypto.createHash('md5').update(serializedOptions).digest('hex');
  return `seq:${modelName}:${operation}:${hash}`;
}
