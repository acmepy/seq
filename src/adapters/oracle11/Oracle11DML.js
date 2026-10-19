import { primaryAttributes, valuesFor, keyObject } from '../../utils/keys.js';
import { DMLAbstract } from '../abstract/DMLAbstract.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { Oracle11Error } from './Oracle11Error.js';

export class Oracle11DML extends DMLAbstract {
  _connection() { return this._adapter._connection(); }
  _tableWithAlias(tableName, alias) { return `${this._q(tableName)}${alias ? ` ${this._q(alias)}` : ''}`; }
  _toError(error, sql) { return Oracle11Error.from(error, sql); }

  _oracleSql(sql) { let index = 0; return sql.replaceAll('?', () => `:${++index}`); }
  async _executeQueryAll(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(async connection => (await connection.execute(this._oracleSql(sql), params, { outFormat: this._adapter._client.OUT_FORMAT_OBJECT })).rows || []);
      } catch (error) {
        throw this._toError(error, this._oracleSql(sql));
      }
    });
  }
  async _executeGet(sql, params = []) { return (await this._executeQueryAll(sql, params))[0] || null; }
  async _execute(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(async connection => {
          const result = await connection.execute(this._oracleSql(sql), params, { autoCommit: !this._adapter._activeTransaction });
          return { changes: result.rowsAffected || 0 };
        });
      } catch (error) {
        throw this._toError(error, this._oracleSql(sql));
      }
    });
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

  _applyDefaults(record, schema) {
    const nullBooleans = Object.entries(schema.columns)
      .filter(([attr, column]) => column.type?.constructor?.name === 'BooleanType' && record[schema.attrToColumn[attr] || attr] === null)
      .map(([attr]) => schema.attrToColumn[attr] || attr);
    super._applyDefaults(record, schema);
    for (const column of nullBooleans) record[column] = null;
  }

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
    const generatedPk = pk && (record[pk] === undefined || record[pk] === null) && this._usesSequenceForAutoIncrement();
    if (generatedPk) record[pk] = { __oracleSequence: this._sequenceName(tableName) };
    const columns = Object.keys(record);
    if (!columns.length) throw new ValidationError('Oracle insert requires at least one column', { code: 'SEQ_ORACLE_EMPTY_INSERT' });
    let bindIndex = 0;
    const params = [];
    const valuesSql = columns.map(column => {
      if (record[column]?.__oracleSequence) return `${this._q(record[column].__oracleSequence)}.NEXTVAL`;
      params.push(this._serializeValue(record[column], schema.columns[schema.columnToAttr[column]]));
      return `:${++bindIndex}`;
    }).join(', ');
    let sql = `INSERT INTO ${this._q(tableName)} (${columns.map(column => this._q(column)).join(', ')}) VALUES (${valuesSql})`;
    const bindParams = [...params];
    if (generatedPk) { sql += ` RETURNING ${this._q(pk)} INTO :${bindParams.length + 1}`; bindParams.push({ dir: this._adapter._client.BIND_OUT, type: this._adapter._client.NUMBER }); }
    const result = await this._measureSql(sql, bindParams, async () => {
      try {
        return await this._adapter._withConnection(connection => connection.execute(sql, bindParams, { autoCommit: !this._adapter._activeTransaction }));
      } catch (error) {
        throw this._toError(error, this._oracleSql(sql));
      }
    });
    if (generatedPk) record[pk] = result.outBinds?.[0]?.[0] ?? result.outBinds?.[bindParams.length - 1]?.[0];
    return new model(this._toAttrNames(record, schema), { _isNew: false });
  }

  async update(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const keys = primaryAttributes(model);
    const changed = keys.filter(key => Object.hasOwn(values, key));
    if (!changed.length) return super.update(model, values, options);
    const matches = await this.selectAll(model, { where: options.where, attributes: keys, transaction: options.transaction });
    if (!matches.length) return [];
    const cascadeFks = [];
    for (const [childTable, childSchema] of this._adapter.schemas) {
      for (const fk of childSchema.foreignKeys || []) {
        const refs = fk.references.columns || [fk.references.column];
        if (fk.references.table === tableName && ['CASCADE', 'SET NULL'].includes(fk.onUpdate)
          && changed.some(key => refs.includes(schema.attrToColumn[key] || key))
          && matches.some(row => changed.some(key => row.getDataValue(key) !== values[key]))) {
          cascadeFks.push({ childTable, childSchema, fk });
        }
      }
    }
    if (!cascadeFks.length) return super.update(model, values, options);
    const ownTransaction = !options.transaction;
    const transaction = options.transaction || await this._adapter.tcl.begin();
    const mutationOptions = { ...options, transaction };
    try {
      for (const { fk } of cascadeFks) await this._execute('SET CONSTRAINTS ' + this._q(fk.constraintName) + ' DEFERRED');
      const updated = await super.update(model, values, mutationOptions);
      for (const previous of matches) {
        for (const { childTable, childSchema, fk } of cascadeFks) {
          const refs = fk.references.columns || [fk.references.column];
          const columns = fk.columnNames || [fk.columnName];
          const oldValues = refs.map(col => previous.getDataValue(schema.columnToAttr[col] || col));
          const newValues = refs.map(col => {
            const attr = schema.columnToAttr[col] || col;
            return fk.onUpdate === 'SET NULL' ? null : Object.hasOwn(values, attr) ? values[attr] : previous.getDataValue(attr);
          });
          const childModel = this._adapter._seq?.getModel(childSchema.modelName);
          if (childModel) {
            const attrs = columns.map(col => childSchema.columnToAttr[col] || col);
            await this.update(childModel, keyObject(attrs, newValues), { ...mutationOptions, where: keyObject(attrs, oldValues), include: undefined });
          } else {
            const set = columns.map(col => this._q(col) + ' = ?').join(', ');
            const where = columns.map(col => this._q(col) + ' = ?').join(' AND ');
            await this._execute('UPDATE ' + this._q(childTable) + ' SET ' + set + ' WHERE ' + where, [...newValues, ...oldValues]);
          }
        }
      }
      for (const { fk } of cascadeFks) await this._execute('SET CONSTRAINTS ' + this._q(fk.constraintName) + ' IMMEDIATE');
      if (ownTransaction) await this._adapter.tcl.commit(transaction);
      return updated;
    } catch (error) {
      if (ownTransaction) await this._adapter.tcl.rollback(transaction);
      throw error;
    }
  }

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._adapter.ddl.truncateTable(tableName);
  }

  _serializeValue(value, column) { if (value instanceof Date) return value; if (value === undefined) return null; if (typeof value === 'boolean') return column?.type?.constructor?.name === 'BooleanType' ? this._adapter.serializeBoolean(value, column) : (value ? 1 : 0); if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value); return value; }
  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }
  _toAttrNames(record, schema) {
    const result = {}; 
    for (const [key, value] of Object.entries(record)) { 
      const attr = schema.columnToAttr[key] || key; 
      if (key === 'SEQ_ROWNUM') continue; 
      const type = schema.columns[attr]?.type?.constructor?.name; 
      if (['ArrayType', 'ObjectType', 'JSONType'].includes(type) && typeof value === 'string') { 
        try { result[attr] = JSON.parse(value); } catch { result[attr] = value; } 
      } else if (type === 'BooleanType') {
        result[attr] = this._adapter.deserializeBoolean(value, schema.columns[attr]);
      }else if (type === 'DateType' && typeof value === 'string') {
        result[attr] = new Date(value); 
      }else if (type === 'IntegerType' || type === 'DecimalType' || type === 'NumberType') {
        result[attr] = this._parseNumericValue(value, type); 
      }else{ 
        result[attr] = value; 
      }
    } 
    return result;
  }
}
