import { DMLAbstract } from '../abstract/DMLAbstract.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { Oracle11Error } from './Oracle11Error.js';

export class Oracle11DML extends DMLAbstract {
  _connection() { return this._adapter._connection(); }
  _tableWithAlias(tableName, alias) { return `${this._q(tableName)}${alias ? ` ${this._q(alias)}` : ''}`; }

  _oracleSql(sql) { let index = 0; return sql.replaceAll('?', () => `:${++index}`); }
  async _executeQueryAll(sql, params = []) {
    this._log('trace', sql, params);
    try { return await this._adapter._withConnection(async connection => (await connection.execute(this._oracleSql(sql), params, { outFormat: this._adapter._client.OUT_FORMAT_OBJECT })).rows || []); }
    catch (error) { throw Oracle11Error.from(error); }
  }
  async _executeGet(sql, params = []) { return (await this._executeQueryAll(sql, params))[0] || null; }
  async _execute(sql, params = []) {
    this._log('trace', sql, params);
    try { return await this._adapter._withConnection(async connection => { const result = await connection.execute(this._oracleSql(sql), params, { autoCommit: !this._adapter._activeTransaction }); return { changes: result.rowsAffected || 0 }; }); }
    catch (error) { throw Oracle11Error.from(error); }
  }

  _applyLimitOffset(sql, options) {
    const { limit, offset = 0 } = options;
    if (limit === undefined && options.offset === undefined) return sql;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    if (limit === undefined) return `SELECT * FROM (SELECT seq_page.*, ROWNUM seq_rownum FROM (${sql}) seq_page) WHERE seq_rownum > ${offset}`;
    return `SELECT * FROM (SELECT seq_page.*, ROWNUM seq_rownum FROM (${sql}) seq_page WHERE ROWNUM <= ${offset + limit}) WHERE seq_rownum > ${offset}`;
  }

  _usesSequenceForAutoIncrement() { return true; }
  _sequenceName(tableName) { return this._adapter.sequenceName(tableName); }

  async count(model, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema, alias } = this._schema(model);
    const where = this._buildWhere(options.where, schema, alias);
    const row = await this._executeGet(`SELECT COUNT(*) AS "cnt" FROM ${this._tableWithAlias(tableName, alias)}${where.sql}`, where.params);
    return row?.cnt ?? 0;
  }

  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const record = this._toColumnNames(values, schema);
    this._applyDefaults(record, schema); this._applyTimestamps(record, schema); this._validateRecord(record, schema, model.modelName);
    const pk = schema.autoIncrement;
    if (pk && record[pk] === undefined && this._usesSequenceForAutoIncrement()) record[pk] = { __oracleSequence: this._sequenceName(tableName) };
    const columns = Object.keys(record);
    if (!columns.length) throw new ValidationError('Oracle insert requires at least one column', { code: 'SEQ_ORACLE_EMPTY_INSERT' });
    let bindIndex = 0;
    const params = [];
    const valuesSql = columns.map(column => {
      if (record[column]?.__oracleSequence) return `${this._q(record[column].__oracleSequence)}.NEXTVAL`;
      params.push(this._serializeValue(record[column]));
      return `:${++bindIndex}`;
    }).join(', ');
    let sql = `INSERT INTO ${this._q(tableName)} (${columns.map(column => this._q(column)).join(', ')}) VALUES (${valuesSql})`;
    const bindParams = [...params];
    if (pk && record[pk] === undefined) { sql += ` RETURNING ${this._q(pk)} INTO :${bindParams.length + 1}`; bindParams.push({ dir: this._adapter._client.BIND_OUT, type: this._adapter._client.NUMBER }); }
    try {
      const result = await this._adapter._withConnection(connection => connection.execute(sql, bindParams, { autoCommit: !this._adapter._activeTransaction }));
      if (pk && record[pk] === undefined) record[pk] = result.outBinds?.[bindParams.length - 1]?.[0];
    } catch (error) { throw Oracle11Error.from(error); }
    return new model(this._toAttrNames(record, schema), { _isNew: false });
  }

  _serializeValue(value) { if (value instanceof Date) return value; if (value === undefined) return null; if (typeof value === 'boolean') return value ? 1 : 0; if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value); return value; }
  _toAttrNames(record, schema) {
    const result = {}; for (const [key, value] of Object.entries(record)) { const attr = schema.columnToAttr[key] || key; if (key === 'SEQ_ROWNUM') continue; const type = schema.columns[attr]?.type?.constructor?.name; if (['ArrayType', 'ObjectType', 'JSONType'].includes(type) && typeof value === 'string') { try { result[attr] = JSON.parse(value); } catch { result[attr] = value; } } else if (type === 'BooleanType') result[attr] = value === true || value === 1 || value === '1'; else if (type === 'DateType' && typeof value === 'string') result[attr] = new Date(value); else if (type === 'DecimalType' || type === 'NumberType') result[attr] = value == null ? value : Number(value); else result[attr] = value; } return result;
  }
}
