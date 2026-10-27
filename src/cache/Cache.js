import { MapCacheAdapter } from './adapters/MapCacheAdapter.js';
import { generateCacheKey, stableStringify } from './utils.js';
import { tenantIdentity } from '../core/TenantResolver.js';
import { Model } from '../core/Model.js';
import { resolveAssociation } from '../utils/include.js';

export class Cache {
  constructor(options = {}) {
    this.options = options;
    this._namespaces = new Map();
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
    const key = generateCacheKey(modelName, operation, queryOptions, this.seq?._tenants.current());
    const result = await this.adapter.get(key);
    this._log('trace', `Cache ${result.hit?'hit':'miss'}: ${key}, model: ${modelName}`);
    return result.hit ? { ...result, value: copyCachedValue(result.value) } : result;
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
    const tenantId = this.seq?._tenants.current();
    const key = generateCacheKey(modelName, operation, queryOptions, tenantId);
    const ttl = this._resolveTtl(modelName);
    const partition = stableStringify(tenantIdentity(tenantId));
    const root = this.seq?.getModel(modelName);
    const dependencies = new Set([modelName]);
    if (root) dependencies.add(`@table:${root._resolvedTableName || root.tableName}`);
    const collect = (includes, model) => {
      for (const include of includes || []) {
        if (include.model) dependencies.add(include.model.modelName);
        if (include.model) dependencies.add(`@table:${include.model._resolvedTableName || include.model.tableName}`);
        const association = model && resolveAssociation(model, include);
        if (association?.throughModel) dependencies.add(association.throughModel.modelName);
        if (association?.type === 'belongsToMany') dependencies.add(`@table:${this.seq.adapter.getAssociationThroughTable(association)}`);
        collect(include.include, include.model);
      }
    };
    collect(queryOptions.include, this.seq?.getModel(modelName));
    const namespace = stableStringify([modelName, partition, [...dependencies].sort()]);
    const entry = this._namespaces.get(namespace) || { partition, dependencies, keys: new Set() };
    entry.keys.add(key);
    this._namespaces.set(namespace, entry);
    await this.adapter.set(key, copyCachedValue(value), modelName, ttl);
  }

  /**
   * Invalidates the cache for a model
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async invalidate(modelName, scope) {
    if (!scope) await this.adapter.invalidate(modelName);
    const partition = scope ? stableStringify(tenantIdentity(scope.tenantId)) : null;
    const model = this.seq?.getModel(modelName);
    const affected = new Map([[modelName, partition]]);
    const pending = model ? [{ table: model._resolvedTableName || model.tableName, partition }] : [];
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      const identity = stableStringify(current);
      if (visited.has(identity)) continue;
      visited.add(identity);
      const dependency = `@table:${current.table}`;
      if (!affected.has(dependency) || affected.get(dependency) !== null) affected.set(dependency, current.partition);
      for (const [table, schema] of this.seq.adapter.schemas) {
        if (!(schema.foreignKeys || []).some(fk => fk.references.table === current.table
          && [fk.onDelete, fk.onUpdate].some(action => action === 'CASCADE' || action === 'SET NULL'))) continue;
        const child = this.seq.models.find(item => (item._resolvedTableName || item.tableName) === table);
        pending.push({ table, partition: child?.options.tenant || schema.tenantAttribute ? current.partition : null });
      }
    }
    for (const [namespace, entry] of this._namespaces) {
      if ([...entry.dependencies].some(dependency => affected.has(dependency)
        && (affected.get(dependency) === null || affected.get(dependency) === entry.partition))) {
        for (const key of entry.keys) await this.adapter.delete(key);
        this._namespaces.delete(namespace);
      }
    }
  }

  /**
   * Clears all cache
   * @returns {Promise<void>}
   */
  async clear() {
    await this.adapter.clear();
    this._namespaces.clear();
  }
}

function copyCachedValue(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(copyCachedValue);
  if (value instanceof Model) return new value.constructor(copyCachedValue(value.dataValues), { _isNew: false, _partial: true });
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyCachedValue(child)]));
  return value;
}
