import crypto from 'node:crypto';
import { tenantIdentity } from '../core/TenantResolver.js';

/**
 * Creates a stable string representation of an object by sorting its keys.
 * @param {*} obj
 * @returns {string}
 */
export function stableStringify(obj) {
  return JSON.stringify(encode(obj));
}

function encode(value) {
  if (value === null) return ['null'];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  if (typeof value === 'function') return ['model', value.modelName || value.name, value._resolvedTableName || value.tableName];
  if (typeof value === 'object') {
    const entries = Reflect.ownKeys(value).filter(key => value[key] !== undefined).map(key => [
      typeof key === 'symbol' ? ['symbol', Symbol.keyFor(key) || key.description] : ['string', key], encode(value[key])
    ]);
    entries.sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
    return ['object', entries];
  }
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (typeof value === 'symbol') return ['symbol', Symbol.keyFor(value) || value.description];
  return [typeof value, value];
}

/**
 * Generates a deterministic hash for cache keys.
 * @param {string} modelName
 * @param {string} operation
 * @param {object} options
 * @returns {string}
 */
export function generateCacheKey(modelName, operation, options = {}, tenantId) {
  // Filter out options that don't affect the SQL result
  const { cache, transaction, hooks, _isNew, _partial, ...cacheableOptions } = options;
  const serializedOptions = stableStringify({ tenant: tenantIdentity(tenantId), options: cacheableOptions });
  const hash = crypto.createHash('sha256').update(serializedOptions).digest('hex');
  return `seq:${modelName}:${operation}:${hash}`;
}
