import { modelTenant } from './TenantResolver.js';
import { tenantQuery, tenantValues } from './TenantQueryScope.js';
import { TenantError } from './errors/TenantError.js';
import { primaryAttributes } from '../utils/keys.js';

/** Apply the same boundary to inherited and dialect-specific DML entry points. */
export function installTenantDML(dml) {
  const mutations = new Set(['insert', 'bulkInsert', 'update', 'delete', 'upsert', 'truncate']);
  for (const operation of ['selectAll', 'selectOne', 'count', ...mutations]) {
    const original = dml[operation];
    if (typeof original !== 'function') continue;
    dml[operation] = function (model, ...args) {
      const seq = this._adapter._seq;
      if (!seq) {
        if (model.options?.tenant) return Promise.reject(new TenantError('Tenant context requires an owning Seq instance', { code: 'SEQ_TENANT_CONTEXT_MISSING' }));
        return original.call(this, model, ...args);
      }
      return seq._tenants.run(async () => {
        const hasValues = ['insert', 'bulkInsert', 'update', 'upsert'].includes(operation);
        const options = tenantQuery(model, args[hasValues ? 1 : 0] || {});
        seq._tenants.assertTransaction(options.transaction);
        this._assertTransaction(options);
        if (operation === 'truncate' && modelTenant(model)) {
          throw new TenantError('truncate is not allowed on tenant models; use destroy instead', { code: 'SEQ_TENANT_TRUNCATE' });
        }
        if (hasValues) {
          const input = operation === 'bulkInsert' ? args[0] : [args[0] || {}];
          const records = input.map(record => tenantValues(model, record));
          // Validate the entire batch before executing the first insert.
          for (const record of records) {
            await validateTenantReferences(this, model, record, options, operation === 'update');
          }
          args = [operation === 'bulkInsert' ? records : records[0], options];
        } else args = [options];
        if (operation === 'count' && options.include?.some(include => include.required)) {
          return (await this.selectAll(model, { ...options, order: undefined, limit: undefined, offset: undefined,
            attributes: primaryAttributes(model).length ? primaryAttributes(model) : undefined })).length;
        }
        const result = await original.call(this, model, ...args);
        if (mutations.has(operation) && seq.cache) await model._invalidateCache(options);
        return result;
      });
    };
  }
  const junctionRows = dml.selectAssociationJunctionRows;
  if (junctionRows) dml.selectAssociationJunctionRows = function (assoc, ids, options = {}) {
    const seq = this._adapter._seq;
    if (!seq) return junctionRows.call(this, assoc, ids, options);
    return seq._tenants.run(() => {
      seq._tenants.resolve(assoc.source);
      seq._tenants.resolve(assoc.target);
      if (assoc.throughModel) seq._tenants.resolve(assoc.throughModel);
      seq._tenants.assertTransaction(options.transaction);
      return junctionRows.call(this, assoc, ids, options);
    });
  };
}

async function validateTenantReferences(dml, model, record, options, update) {
  const seq = model.seq;
  const schema = dml._schema(model).schema;
  for (const fk of schema.foreignKeys || []) {
    const parent = seq.getModel(fk.references.model);
    if (!parent || !modelTenant(parent)) continue;
    const fields = fk.attributeNames || [fk.attributeName || schema.columnToAttr[fk.columnName]];
    const keys = fk.references.keys || [fk.references.key];
    if (!update) for (const field of fields) {
      const defaultValue = model.rawAttributes[field]?.defaultValue;
      if (record[field] === undefined && defaultValue !== undefined) {
        record[field] = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
      }
    }
    if (update && !fields.some(field => Object.hasOwn(record, field))) continue;
    let rows = [record];
    if (update && fields.some(field => !Object.hasOwn(record, field))) {
      const previous = await dml.selectAll(model, { where: options.where, transaction: options.transaction });
      rows = previous.map(row => ({ ...row.dataValues, ...record }));
    }
    for (const row of rows) {
      const values = fields.map(field => row[field]);
      if (values.some(value => value === null || value === undefined)) continue;
      const where = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
      const target = await dml.selectOne(parent, { where, transaction: options.transaction });
      if (!target) {
        throw new TenantError('Referenced record is not accessible in the current tenant', { code: 'SEQ_TENANT_REFERENCE' });
      }
    }
  }
}

export function installTenantTransactions(tcl) {
  for (const operation of ['begin', 'commit', 'rollback']) {
    const original = tcl[operation];
    tcl[operation] = function (...args) {
      const seq = this._adapter._seq;
      if (!seq) return original.apply(this, args);
      return seq._tenants.run(async () => {
        if (operation !== 'begin') seq._tenants.assertTransaction(args[0]);
        const result = await original.apply(this, args);
        if (operation === 'begin') {
          seq._tenants.bindTransaction(result);
          result.afterCommitCallbacks = [];
          result.afterCommit = callback => result.afterCommitCallbacks.push(callback);
        } else {
          const callbacks = args[0].afterCommitCallbacks?.splice(0) || [];
          if (operation === 'commit') for (const callback of callbacks) await callback();
        }
        return result;
      });
    };
  }
}
