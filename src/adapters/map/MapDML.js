import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { clone } from '../../utils/clone.js';

/**
 * DML operations for the MapAdapter.
 * Handles insert, select, update, delete, and truncate.
 *
 * Transaction strategy: all operations write directly to the main tables.
 * On rollback, the main tables are restored from the snapshot taken at begin.
 * On commit, no action needed since changes are already in the main tables.
 */
export class MapDML {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    this._adapter = adapter;
  }

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values
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

    const record = { ...values };

    // Apply auto-increment
    if (schema.autoIncrement) {
      const seq = this._adapter.sequences.get(model.tableName) || 1;
      record[schema.autoIncrement] = seq;
      this._adapter.sequences.set(model.tableName, seq + 1);
    }

    // Apply default values
    for (const [name, colDef] of Object.entries(schema.columns)) {
      if (!(name in record) || record[name] === undefined) {
        if (colDef.defaultValue !== undefined) {
          record[name] = typeof colDef.defaultValue === 'function'
            ? colDef.defaultValue()
            : colDef.defaultValue;
        } else {
          record[name] = null;
        }
      }
    }

    // Apply timestamps
    if (schema.timestamps) {
      const now = new Date();
      if (!record[schema.createdAt]) {
        record[schema.createdAt] = now;
      }
      if (!record[schema.updatedAt]) {
        record[schema.updatedAt] = now;
      }
    }

    // Validate
    this._validateRecord(record, schema, model.modelName);

    // Check primary key uniqueness
    if (schema.primaryKey) {
      const pkValue = record[schema.primaryKey];
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

    // Store cloned record
    const storedRecord = clone(record);
    if (schema.primaryKey) {
      table.set(record[schema.primaryKey], storedRecord);
    } else {
      const idx = table.size;
      table.set(idx, storedRecord);
    }

    // Return a model instance
    const instance = new model(record, { _isNew: false });
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
   * Internal select implementation with filtering, ordering, limit and offset.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} options
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   * @private
   */
  async _select(model, options = {}) {
    const table = this._adapter.database.get(model.tableName);
    let results = [];

    for (const [, record] of table) {
      results.push(clone(record));
    }

    // Apply where
    if (options.where) {
      results = results.filter(record => this._matchWhere(record, options.where));
    }

    // Apply order
    if (options.order) {
      results.sort((a, b) => {
        for (const [field, direction] of options.order) {
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

    return results.map(record => new model(record, { _isNew: false }));
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    const table = this._adapter.database.get(model.tableName);
    let count = 0;

    for (const [, record] of table) {
      if (options.where) {
        if (this._matchWhere(record, options.where)) {
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
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async update(model, values, options = {}) {
    const table = this._adapter.database.get(model.tableName);
    const schema = this._adapter.schemas.get(model.tableName);
    const updatedInstances = [];
    const now = new Date();

    const toUpdate = [];
    for (const [key, record] of table) {
      if (options.where) {
        if (this._matchWhere(record, options.where)) {
          toUpdate.push({ key, record });
        }
      } else {
        toUpdate.push({ key, record });
      }
    }

    for (const { key, record } of toUpdate) {
      for (const [name, value] of Object.entries(values)) {
        if (name === schema?.primaryKey) continue;
        record[name] = value;
      }

      if (schema?.timestamps && schema.updatedAt) {
        record[schema.updatedAt] = now;
      }

      if (schema) {
        this._validateRecord(record, schema, model.modelName);
      }

      updatedInstances.push(new model(clone(record), { _isNew: false }));
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
    let count = 0;

    const keysToDelete = [];
    for (const [key, record] of table) {
      if (options.where) {
        if (this._matchWhere(record, options.where)) {
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
   * Matches a record against a where clause (equality only).
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
   * Validates a record against a schema.
   * @param {object} record
   * @param {object} schema
   * @param {string} modelName
   * @private
   */
  _validateRecord(record, schema, modelName) {
    for (const [name, colDef] of Object.entries(schema.columns)) {
      const value = record[name];

      if (!colDef.allowNull && (value === null || value === undefined)) {
        throw new ValidationError(
          `Field "${name}" does not allow null values in model "${modelName}"`,
          {
            code: 'SEQ_VALIDATION_NOT_NULL',
            details: { model: modelName, field: name }
          }
        );
      }

      if (value !== null && value !== undefined && colDef.type && typeof colDef.type.validate === 'function') {
        const result = colDef.type.validate(value);
        if (!result.valid) {
          throw new ValidationError(
            `Validation failed for field "${name}" in model "${modelName}": ${result.message}`,
            {
              code: 'SEQ_VALIDATION_TYPE',
              details: { model: modelName, field: name, value }
            }
          );
        }
      }

      if (typeof value === 'string' && colDef.type?.options?.length) {
        if (value.length > colDef.type.options.length) {
          throw new ValidationError(
            `Field "${name}" exceeds maximum ${colDef.type.options.length} characters in model "${modelName}"`,
            {
              code: 'SEQ_VALIDATION_LENGTH',
              details: { model: modelName, field: name, maxLength: colDef.type.options.length, actualLength: value.length }
            }
          );
        }
      }
    }
  }
}
