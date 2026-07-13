import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';

/**
 * Base DML abstract.
 * Defines the full DML contract and provides adapter-agnostic helpers.
 * Adapter-specific subclasses must override all public methods.
 */
export class DMLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    throw new AdapterError('DML insert is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Inserts multiple records.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object[]} records
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async bulkInsert(model, records, options = {}) {
    throw new AdapterError('DML bulkInsert is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Selects a record by primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectByPk(model, id, options = {}) {
    throw new AdapterError('DML selectByPk is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Selects one record matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectOne(model, options = {}) {
    throw new AdapterError('DML selectOne is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Selects all records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async selectAll(model, options = {}) {
    throw new AdapterError('DML selectAll is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    throw new AdapterError('DML count is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Updates records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async update(model, values, options = {}) {
    throw new AdapterError('DML update is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Deletes records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async delete(model, options = {}) {
    throw new AdapterError('DML delete is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Truncates all records in a table.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async truncate(model, options = {}) {
    throw new AdapterError('DML truncate is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

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
   * Matches a column-name record against a column-name where clause.
   * @param {object} record
   * @param {object} where
   * @returns {boolean}
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
   */
  _validateRecord(record, schema, modelName) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;

      if (schema.autoIncrement && colName === schema.autoIncrement) {
        continue;
      }

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
