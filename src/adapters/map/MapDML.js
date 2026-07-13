import { AdapterError } from '../../core/errors/AdapterError.js';
import { clone } from '../../utils/clone.js';
import { DMLAbstract } from '../abstract/DMLAbstract.js';

/**
 * DML operations for the MapAdapter.
 * Handles insert, select, update, delete, and truncate.
 *
 * Extends DMLAbstract which provides adapter-agnostic helpers:
 * _toColumnNames, _toAttrNames, _translateWhere, _matchWhere, _validateRecord.
 *
 * Records in the database use column names (from `field`).
 * Model instances use attribute names.
 */
export class MapDML extends DMLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  /**
   * Returns the effective table name for a model.
   * Uses _resolvedTableName if set by Seq (convention-applied), otherwise falls back to tableName.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {string}
   */
  _getTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);

    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }

    const colRecord = this._toColumnNames(values, schema);

    if (schema.autoIncrement) {
      const seq = this._adapter.sequences.get(tableName) || 1;
      colRecord[schema.autoIncrement] = seq;
      this._adapter.sequences.set(tableName, seq + 1);
    }

    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      if (!(colName in colRecord) || colRecord[colName] === undefined) {
        if (colDef.defaultValue !== undefined) {
          colRecord[colName] = typeof colDef.defaultValue === 'function'
            ? colDef.defaultValue()
            : colDef.defaultValue;
        } else {
          colRecord[colName] = null;
        }
      }
    }

    if (schema.timestamps) {
      const now = new Date();
      const createdCol = schema.attrToColumn[schema.createdAt] || schema.createdAt;
      const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
      if (!colRecord[createdCol]) {
        colRecord[createdCol] = now;
      }
      if (!colRecord[updatedCol]) {
        colRecord[updatedCol] = now;
      }
    }

    this._validateRecord(colRecord, schema, model.modelName);

    if (schema.primaryKey) {
      const pkValue = colRecord[schema.primaryKey];
      if (pkValue !== null && pkValue !== undefined && table.has(pkValue)) {
        throw new AdapterError(
          `Duplicate primary key value "${pkValue}" for model "${model.modelName}"`,
          { code: 'SEQ_VALIDATION_DUPLICATE_PK' }
        );
      }
    }

    const storedRecord = clone(colRecord);
    if (schema.primaryKey) {
      table.set(colRecord[schema.primaryKey], storedRecord);
    } else {
      table.set(table.size, storedRecord);
    }

    const attrRecord = this._toAttrNames(colRecord, schema);
    return new model(attrRecord, { _isNew: false });
  }

  /**
   * Inserts multiple records.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object[]} records
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async bulkInsert(model, records, options = {}) {
    const results = [];
    for (const record of records) {
      results.push(await this.insert(model, record, options));
    }
    return results;
  }

  /**
   * Selects a record by primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectByPk(model, id, options = {}) {
    return this.selectOne(model, { ...options, where: { [model.primaryKeyAttribute]: id } });
  }

  /**
   * Selects one record matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectOne(model, options = {}) {
    const results = await this._select(model, options);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Selects all records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async selectAll(model, options = {}) {
    return this._select(model, options);
  }

  /**
   * Internal select implementation.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} options
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   * @private
   */
  async _select(model, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let results = [];

    for (const [, record] of table) {
      results.push(clone(record));
    }

    if (options.where) {
      const colWhere = this._translateWhere(options.where, schema);
      results = results.filter(record => this._matchWhere(record, colWhere));
    }

    if (options.order) {
      const colOrder = options.order.map(([attr, dir]) => {
        const col = schema?.attrToColumn?.[attr] || attr;
        return [col, dir];
      });
      results.sort((a, b) => {
        for (const [field, direction] of colOrder) {
          const dir = (direction || 'ASC').toUpperCase();
          const aVal = a[field];
          const bVal = b[field];
          if (aVal === bVal) continue;
          if (aVal === null || aVal === undefined) return dir === 'ASC' ? -1 : 1;
          if (bVal === null || bVal === undefined) return dir === 'ASC' ? 1 : -1;
          const cmp = aVal < bVal ? -1 : 1;
          return dir === 'ASC' ? cmp : -cmp;
        }
        return 0;
      });
    }

    if (options.offset) {
      results = results.slice(options.offset);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results.map(record => {
      const attrRecord = schema ? this._toAttrNames(record, schema) : record;
      return new model(attrRecord, { _isNew: false });
    });
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let count = 0;

    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    for (const [, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          count++;
        }
      } else {
        count++;
      }
    }

    return count;
  }

  /**
   * Updates records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async update(model, values, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    const updatedInstances = [];
    const now = new Date();

    const colValues = this._toColumnNames(values, schema);
    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    const toUpdate = [];
    for (const [key, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          toUpdate.push({ key, record });
        }
      } else {
        toUpdate.push({ key, record });
      }
    }

    for (const { key, record } of toUpdate) {
      for (const [colName, value] of Object.entries(colValues)) {
        if (colName === schema?.primaryKey) continue;
        record[colName] = value;
      }

      if (schema?.timestamps && schema.updatedAt) {
        const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
        record[updatedCol] = now;
      }

      if (schema) {
        this._validateRecord(record, schema, model.modelName);
      }

      const attrRecord = schema ? this._toAttrNames(clone(record), schema) : clone(record);
      updatedInstances.push(new model(attrRecord, { _isNew: false }));
    }

    return updatedInstances;
  }

  /**
   * Deletes records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async delete(model, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let count = 0;

    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    const keysToDelete = [];
    for (const [key, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          keysToDelete.push(key);
        }
      } else {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      table.delete(key);
      count++;
    }

    return count;
  }

  /**
   * Truncates all records in a table.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async truncate(model, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    table.clear();
    this._adapter.sequences.set(tableName, 1);
  }
}
