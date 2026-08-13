import { DMLAbstract } from '../abstract/DMLAbstract.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { MySQLError } from './MySQLError.js';

export class MySQLDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _connection() {
    return this._adapter._connection();
  }

  async _executeQueryAll(sql, params = []) {
    this._log('trace', sql, params);
    try {
      const [rows] = await this._connection().execute(sql, params);
      return rows;
    } catch (error) {
      throw MySQLError.from(error);
    }
  }

  async _executeGet(sql, params = []) {
    const rows = await this._executeQueryAll(sql, params);
    return rows[0] || null;
  }

  async _execute(sql, params = []) {
    this._log('trace', sql, params);
    try {
      const [result] = await this._connection().execute(sql, params);
      return {
        changes: result.affectedRows || 0,
        lastInsertRowid: result.insertId || 0
      };
    } catch (error) {
      throw MySQLError.from(error);
    }
  }

  _buildLimitOffset(options) {
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    }
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
      throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    }
    if (options.limit && options.offset) return ` LIMIT ${options.limit} OFFSET ${options.offset}`;
    if (options.limit) return ` LIMIT ${options.limit}`;
    if (options.offset) return ` LIMIT 18446744073709551615 OFFSET ${options.offset}`;
    return '';
  }

  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];
    this._validateRecord(colRecord, schema, model.modelName);

    const cols = Object.keys(colRecord);
    if (cols.length === 0) {
      const info = await this._execute(`INSERT INTO ${this._q(tableName)} () VALUES ()`, []);
      if (schema.primaryKey) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      return new model(this._toAttrNames(colRecord, schema), { _isNew: false });
    }

    const colNames = cols.map(c => this._q(c)).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
    const params = cols.map(c => this._serializeValue(colRecord[c]));
    const info = await this._execute(sql, params);
    if (schema.primaryKey && !colRecord[schema.primaryKey]) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
    return new model(this._toAttrNames(colRecord, schema), { _isNew: false });
  }

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._execute('SET FOREIGN_KEY_CHECKS = 0', []);
    try {
      await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`, []);
    } finally {
      await this._execute('SET FOREIGN_KEY_CHECKS = 1', []);
    }
  }

  _serializeValue(value) {
    if (value instanceof Date) return this._formatDate(value);
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value);
    return value;
  }

  _toAttrNames(record, schema) {
    const result = {};
    const map = schema.columnToAttr;
    const columns = schema.columns || {};
    for (const [key, value] of Object.entries(record)) {
      const attrName = map[key] || key;
      const colDef = columns[attrName];
      const typeName = colDef?.type?.constructor?.name;
      if (typeName === 'ArrayType' || typeName === 'ObjectType' || typeName === 'JSONType') {
        if (typeof value === 'string') {
          try { result[attrName] = JSON.parse(value); } catch { result[attrName] = value; }
        } else {
          result[attrName] = value;
        }
      } else if (typeName === 'BooleanType') {
        if (typeof value === 'boolean') result[attrName] = value;
        else result[attrName] = value === 1 || value === '1';
      } else if (typeName === 'DateType') {
        if (value instanceof Date) result[attrName] = value;
        else if (typeof value === 'string') result[attrName] = new Date(value);
        else result[attrName] = value;
      } else if (typeName === 'DecimalType' || typeName === 'NumberType') {
        result[attrName] = value === null || value === undefined ? value : Number(value);
      } else {
        result[attrName] = value;
      }
    }
    return result;
  }

  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }

  _formatDate(date) {
    return date.toISOString().slice(0, 23).replace('T', ' ');
  }
}
