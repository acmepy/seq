import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { clone } from '../../utils/clone.js';

/**
 * DML operations for the MapAdapter.
 * Handles insert, select, update, delete, and truncate.
 *
 * Records in the database use column names (from `field`).
 * Model instances use attribute names.
 * All translation happens here via the schema's attrToColumn/columnToAttr maps.
 */
export class MapDML {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    this._adapter = adapter;
  }

  /**
   * Translates a record from attribute names to column names.
   * @param {object} record
   * @param {object} schema
   * @returns {object}
   */
  _toColumnNames(record, schema) {
    const result = {};
    const map = schema.attrToColumn;
    for (const [key, value] of Object.entries(record)) {
      result[map[key] || key] = value;
    }
    return result;
  }

  /**
   * Translates a record from column names to attribute names.
   * @param {object} record
   * @param {object} schema
   * @returns {object}
   */
  _toAttrNames(record, schema) {
    const result = {};
    const map = schema.columnToAttr;
    for (const [key, value] of Object.entries(record)) {
      result[map[key] || key] = value;
    }
    return result;
  }

  /**
   * Translates a where clause from attribute names to column names.
   * @param {object} where
   * @param {object} schema
   * @returns {object}
   */
  _translateWhere(where, schema) {
    return this._toColumnNames(where, schema);
  }

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);

    if (!schema) {
      throw new AdapterError(`Table "${model.tableName}" does not exist`, {
        code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'
      });
    }

    // Start with a record keyed by column names
    const colRecord = this._toColumnNames(values, schema);

    // Apply auto-increment (schema.autoIncrement is a column name)
    if (schema.autoIncrement) {
      const seq = this._adapter.sequences.get(model.tableName) || 1;
      colRecord[schema.autoIncrement] = seq;
      this._adapter.sequences.set(model.tableName, seq + 1);
    }

    // Apply default values (iterate columns by attr name, store by column name)
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

    // Apply timestamps (schema.createdAt/updatedAt are attr names)
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

    // Validate (convert to attr names for validation messages)
    this._validateRecord(colRecord, schema, model.modelName);

    // Check primary key uniqueness (schema.primaryKey is a column name)
    if (schema.primaryKey) {
      const pkValue = colRecord[schema.primaryKey];
      if (pkValue !== null && pkValue !== undefined && table.has(pkValue)) {
        throw new ValidationError(
          `Duplicate primary key value "${pkValue}" for model "${model.modelName}"`,
          {
            code: 'SEQ_VALIDATION_DUPLICATE_PK',
            details: { model: model.modelName, primaryKey: schema.primaryKey, value: pkValue }
          }
        );
      }
    }

    // Store cloned record (column names)
    const storedRecord = clone(colRecord);
    if (schema.primaryKey) {
      table.set(colRecord[schema.primaryKey], storedRecord);
    } else {
      const idx = table.size;
      table.set(idx, storedRecord);
    }

    // Return model instance (translate back to attr names)
    const attrRecord = this._toAttrNames(colRecord, schema);
    const instance = new model(attrRecord, { _isNew: false });
    return instance;
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
    const where = { [model.primaryKeyAttribute]: id };
    return this.selectOne(model, { ...options, where });
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
   * Reads column-name records from DB, translates to attr names for model instances.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} options
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   * @private
   */
  async _select(model, options = {}) {
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);
    let results = [];

    for (const [, record] of table) {
      results.push(clone(record));
    }

    // Apply where (user passes attr names, translate to column names for matching)
    if (options.where) {
      const colWhere = this._translateWhere(options.where, schema);
      results = results.filter(record => this._matchWhere(record, colWhere));
    }

    // Apply order (user passes attr names, translate to column names)
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

    // Apply offset
    if (options.offset) {
      results = results.slice(options.offset);
    }

    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    // Translate column-name records to attr-name records for model instances
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
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);
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
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);
    const updatedInstances = [];
    const now = new Date();

    // Translate values from attr names to column names
    const colValues = this._toColumnNames(values, schema);

    // Translate where from attr names to column names
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

      // Apply updatedAt (schema.updatedAt is attr name, translate to column name)
      if (schema?.timestamps && schema.updatedAt) {
        const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
        record[updatedCol] = now;
      }

      if (schema) {
        this._validateRecord(record, schema, model.modelName);
      }

      // Translate back to attr names for model instance
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
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);
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
    const table = this._adapter.database.get(model.tableName);
    table.clear();
    this._adapter.sequences.set(model.tableName, 1);
  }

  /**
   * Matches a column-name record against a column-name where clause.
   * @param {object} record
   * @param {object} where
   * @returns {boolean}
   * @private
   */
  _matchWhere(record, where) {
    for (const [key, value] of Object.entries(where)) {
      if (record[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validates a column-name record against the schema.
   * @param {object} record - Record with column names
   * @param {object} schema
   * @param {string} modelName
   * @private
   */
  _validateRecord(record, schema, modelName) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      const value = record[colName];

      if (!colDef.allowNull && (value === null || value === undefined)) {
        throw new ValidationError(
          `Field "${attrName}" does not allow null values in model "${modelName}"`,
          {
            code: 'SEQ_VALIDATION_NOT_NULL',
            details: { model: modelName, field: attrName }
          }
        );
      }

      if (value !== null && value !== undefined && colDef.type && typeof colDef.type.validate === 'function') {
        const result = colDef.type.validate(value);
        if (!result.valid) {
          throw new ValidationError(
            `Validation failed for field "${attrName}" in model "${modelName}": ${result.message}`,
            {
              code: 'SEQ_VALIDATION_TYPE',
              details: { model: modelName, field: attrName, value }
            }
          );
        }
      }

      if (typeof value === 'string' && colDef.type?.options?.length) {
        if (value.length > colDef.type.options.length) {
          throw new ValidationError(
            `Field "${attrName}" exceeds maximum ${colDef.type.options.length} characters in model "${modelName}"`,
            {
              code: 'SEQ_VALIDATION_LENGTH',
              details: { model: modelName, field: attrName, maxLength: colDef.type.options.length, actualLength: value.length }
            }
          );
        }
      }
    }
  }
}
