import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';

/**
 * Base DML abstract.
 * Provides SQL-based default implementations for selectAll, count, update, delete.
 * Adapter subclasses implement execution hooks (_executeQuery, _executeGet, _executeRun, _mapRows)
 * and adapter-specific methods (insert, truncate).
 */
export class DMLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Returns the effective table name for a model.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {string}
   */
  _getTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  /**
   * Returns the table name and schema for a model.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {{ tableName: string, schema: object }}
   */
  _schema(model) {
    const tableName = this._getTableName(model);
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    return { tableName, schema };
  }

  /**
   * Applies default values to a column-name record.
   * @param {object} colRecord
   * @param {object} schema
   */
  _applyDefaults(colRecord, schema) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      if (!(colName in colRecord) || colRecord[colName] === undefined || colRecord[colName] === null) {
        if (colDef.defaultValue !== undefined) {
          colRecord[colName] = typeof colDef.defaultValue === 'function'
            ? colDef.defaultValue()
            : colDef.defaultValue;
        }
      }
    }
  }

  /**
   * Applies timestamp columns (createdAt, updatedAt) to a column-name record.
   * @param {object} colRecord
   * @param {object} schema
   */
  _applyTimestamps(colRecord, schema) {
    if (schema.timestamps) {
      const now = new Date();
      const createdCol = schema.attrToColumn[schema.createdAt] || schema.createdAt;
      const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
      if (!colRecord[createdCol]) colRecord[createdCol] = now;
      if (!colRecord[updatedCol]) colRecord[updatedCol] = now;
    }
  }

  /**
   * Serializes a value for SQL parameter binding.
   * Default is pass-through. Override in adapter for type-specific serialization.
   * @param {*} v
   * @returns {*}
   */
  _serializeValue(v) {
    return v;
  }

  // ---------------------------------------------------------------------------
  // SQL builders — generate standard SQL fragments
  // ---------------------------------------------------------------------------

  /**
   * Builds a WHERE clause from a where object.
   * @param {object} where - Attribute-name where clause
   * @param {object} schema
   * @returns {{ sql: string, params: *[] }}
   */
  _buildWhere(where, schema) {
    if (!where) return { sql: '', params: [] };
    const colWhere = this._translateWhere(where, schema);
    const params = [];
    const conditions = Object.entries(colWhere).map(([k, v]) => {
      params.push(this._serializeValue(v));
      return `"${k}" = ?`;
    });
    return { sql: ` WHERE ${conditions.join(' AND ')}`, params };
  }

  /**
   * Builds an ORDER BY clause.
   * @param {Array} order - Array of [attr, direction] pairs
   * @param {object} schema
   * @returns {string}
   */
  _buildOrderBy(order, schema) {
    if (!order || order.length === 0) return '';
    const clauses = order.map(([attr, dir]) => {
      const col = schema.attrToColumn[attr] || attr;
      return `"${col}" ${dir}`;
    });
    return ` ORDER BY ${clauses.join(', ')}`;
  }

  /**
   * Builds a LIMIT/OFFSET clause.
   * @param {object} options
   * @returns {string}
   */
  _buildLimitOffset(options) {
    if (options.limit && options.offset) {
      return ` LIMIT ${options.limit} OFFSET ${options.offset}`;
    } else if (options.limit) {
      return ` LIMIT ${options.limit}`;
    } else if (options.offset) {
      return ` LIMIT -1 OFFSET ${options.offset}`;
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Abstract execution hooks — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Executes a query and returns all matching rows.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<object[]>}
   */
  async _executeQueryAll(sql, params) {
    throw new AdapterError('DML _executeQuery is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Executes a query and returns a single row.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<object|null>}
   */
  async _executeGet(sql, params) {
    throw new AdapterError('DML _executeGet is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Executes a statement (INSERT, UPDATE, DELETE) and returns result info.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<{ changes: number, lastInsertRowid?: number }>}
   */
  async _executeRun(sql, params) {
    throw new AdapterError('DML _executeRun is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Maps raw rows to Model instances.
   * @param {object[]} rows
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} schema
   * @returns {import('../../core/Model.js').Model[]}
   */
  _mapRows(rows, model, schema) {
    throw new AdapterError('DML _mapRows is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Template methods — SQL generation + execution hooks
  // ---------------------------------------------------------------------------

  /**
   * Selects all records matching the options.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async selectAll(model, options = {}) {
    this._log('DML.selectAll', model.modelName, options);
    const { tableName, schema } = this._schema(model);
    let sql = `SELECT * FROM "${tableName}"`;
    const params = [];
    const where = this._buildWhere(options.where, schema);
    sql += where.sql;
    params.push(...where.params);
    sql += this._buildOrderBy(options.order, schema);
    sql += this._buildLimitOffset(options);
    const rows = await this._executeQueryAll(sql, params);
    return this._mapRows(rows, model, schema);
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    this._log('DML.count', model.modelName, options);
    const { tableName, schema } = this._schema(model);
    let sql = `SELECT COUNT(*) as cnt FROM "${tableName}"`;
    const params = [];
    const where = this._buildWhere(options.where, schema);
    sql += where.sql;
    params.push(...where.params);
    const row = await this._executeGet(sql, params);
    return row.cnt;
  }

  /**
   * Updates records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async update(model, values, options = {}) {
    this._log('DML.update', model.modelName, values, options);
    const { tableName, schema } = this._schema(model);
    const colValues = this._toColumnNames(values, schema);
    this._applyTimestamps(colValues, schema);
    const setClauses = Object.keys(colValues).map(k => `"${k}" = ?`);
    const params = [...Object.values(colValues).map(v => this._serializeValue(v))];
    const where = this._buildWhere(options.where, schema);
    const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')}${where.sql}`;
    params.push(...where.params);
    await this._executeRun(sql, params);
    if (options.where) return await this.selectAll(model, options);
    return [];
  }

  /**
   * Deletes records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async delete(model, options = {}) {
    this._log('DML.delete', model.modelName, options);
    const { tableName, schema } = this._schema(model);
    const params = [];
    const where = this._buildWhere(options.where, schema);
    const sql = `DELETE FROM "${tableName}"${where.sql}`;
    params.push(...where.params);
    const info = await this._executeRun(sql, params);
    return info.changes;
  }

  // ---------------------------------------------------------------------------
  // Template methods — insert
  // ---------------------------------------------------------------------------

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    this._log('DML.insert', model.modelName, values);
    const { tableName, schema } = this._schema(model);
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) {
      delete colRecord[schema.autoIncrement];
    }
    this._validateRecord(colRecord, schema, model.modelName);
    const cols = Object.keys(colRecord);
    const colNames = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`;
    const params = cols.map(c => this._serializeValue(colRecord[c]));
    const info = await this._executeRun(sql, params);
    if (schema.primaryKey && !colRecord[schema.primaryKey]) {
      colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
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
    for (const rec of records) {
      results.push(await this.insert(model, rec, options));
    }
    return results;
  }

  /**
   * Truncates all records in a table.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async truncate(model, options = {}) {
    this._log('DML.truncate', model.modelName);
    throw new AdapterError('DML truncate is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // High-level methods — delegate to selectAll
  // ---------------------------------------------------------------------------

  /**
   * Selects a record by primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectByPk(model, id, options = {}) {
    if (!model.primaryKeyAttribute) {
      throw new AdapterError(`Model "${model.modelName}" has no primary key`, { code: 'SEQ_DML_NO_PRIMARY_KEY' });
    }
    const where = { [model.primaryKeyAttribute]: id };
    const results = await this.selectAll(model, { ...options, where, limit: 1, offset: 0 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Selects one record matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectOne(model, options = {}) {
    const results = await this.selectAll(model, { ...options, limit: 1, offset: 0 });
    return results.length > 0 ? results[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Translation helpers — attribute ↔ column name mapping
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
