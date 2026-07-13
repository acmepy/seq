import { DMLAbstract } from '../abstract/DMLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

export class SQLiteDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  _getTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  _schema(model) {
    const tableName = this._getTableName(model);
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    return { tableName, schema };
  }

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

  _applyTimestamps(colRecord, schema) {
    if (schema.timestamps) {
      const now = new Date().toISOString();
      const createdCol = schema.attrToColumn[schema.createdAt] || schema.createdAt;
      const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
      if (!colRecord[createdCol]) colRecord[createdCol] = now;
      if (!colRecord[updatedCol]) colRecord[updatedCol] = now;
      if (colRecord[createdCol] instanceof Date) colRecord[createdCol] = colRecord[createdCol].toISOString();
      if (colRecord[updatedCol] instanceof Date) colRecord[updatedCol] = colRecord[updatedCol].toISOString();
    }
  }

  _serializeValue(v) {
    if (v instanceof Date) return v.toISOString();
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return JSON.stringify(v);
    return v;
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
      } else {
        result[attrName] = value;
      }
    }
    return result;
  }

  async insert(model, values, options = {}) {
    const { tableName, schema } = this._schema(model);

    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);

    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) {
      delete colRecord[schema.autoIncrement];
    }

    this._validateRecord(colRecord, schema, model.modelName);

    const cols = Object.keys(colRecord);
    const placeholders = cols.map(() => '?').join(', ');
    const colNames = cols.map(c => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`;

    const params = cols.map(c => this._serializeValue(colRecord[c]));
    const info = this._db().prepare(sql).run(...params);
    if (schema.primaryKey && !colRecord[schema.primaryKey]) {
      colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
    }

    const attrRecord = this._toAttrNames(colRecord, schema);
    return new model(attrRecord, { _isNew: false });
  }

  async bulkInsert(model, records, options = {}) {
    const results = [];
    for (const rec of records) {
      results.push(await this.insert(model, rec, options));
    }
    return results;
  }

  async selectByPk(model, id, options = {}) {
    const { tableName, schema } = this._schema(model);
    const pkCol = schema.primaryKey;
    const sql = `SELECT * FROM "${tableName}" WHERE "${pkCol}" = ? LIMIT 1`;
    const row = this._db().prepare(sql).get(id);
    if (!row) return null;
    return new model(this._toAttrNames(row, schema), { _isNew: false });
  }

  async selectOne(model, options = {}) {
    const { tableName, schema } = this._schema(model);
    let sql = `SELECT * FROM "${tableName}"`;
    const params = [];
    if (options.where) {
      const where = this._translateWhere(options.where, schema);
      const conditions = Object.entries(where).map(([k, v]) => { params.push(this._serializeValue(v)); return `"${k}" = ?`; });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' LIMIT 1';
    const row = this._db().prepare(sql).get(...params);
    if (!row) return null;
    return new model(this._toAttrNames(row, schema), { _isNew: false });
  }

  async selectAll(model, options = {}) {
    const { tableName, schema } = this._schema(model);
    let sql = `SELECT * FROM "${tableName}"`;
    const params = [];
    if (options.where) {
      const where = this._translateWhere(options.where, schema);
      const conditions = Object.entries(where).map(([k, v]) => { params.push(this._serializeValue(v)); return `"${k}" = ?`; });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    if (options.order) {
      const orderClauses = options.order.map(([attr, dir]) => {
        const col = schema.attrToColumn[attr] || attr;
        return `"${col}" ${dir}`;
      });
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }
    const rows = this._db().prepare(sql).all(...params);
    return rows.map(row => new model(this._toAttrNames(row, schema), { _isNew: false }));
  }

  async count(model, options = {}) {
    const { tableName, schema } = this._schema(model);
    let sql = `SELECT COUNT(*) as cnt FROM "${tableName}"`;
    const params = [];
    if (options.where) {
      const where = this._translateWhere(options.where, schema);
      const conditions = Object.entries(where).map(([k, v]) => { params.push(this._serializeValue(v)); return `"${k}" = ?`; });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    const row = this._db().prepare(sql).get(...params);
    return row.cnt;
  }

  async update(model, values, options = {}) {
    const { tableName, schema } = this._schema(model);
    const colValues = this._toColumnNames(values, schema);
    this._applyTimestamps(colValues, schema);

    const setClauses = Object.keys(colValues).map(k => `"${k}" = ?`);
    const params = [...Object.values(colValues).map(v => this._serializeValue(v))];

    let whereSql = '';
    if (options.where) {
      const where = this._translateWhere(options.where, schema);
      const conditions = Object.entries(where).map(([k, v]) => { params.push(this._serializeValue(v)); return `"${k}" = ?`; });
      whereSql = ` WHERE ${conditions.join(' AND ')}`;
    }

    const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')}${whereSql}`;
    this._db().prepare(sql).run(...params);

    if (options.where) {
      return await this.selectAll(model, options);
    }
    return [];
  }

  async delete(model, options = {}) {
    const { tableName, schema } = this._schema(model);
    let whereSql = '';
    const params = [];
    if (options.where) {
      const where = this._translateWhere(options.where, schema);
      const conditions = Object.entries(where).map(([k, v]) => { params.push(this._serializeValue(v)); return `"${k}" = ?`; });
      whereSql = ` WHERE ${conditions.join(' AND ')}`;
    }
    const sql = `DELETE FROM "${tableName}"${whereSql}`;
    const info = this._db().prepare(sql).run(...params);
    return info.changes;
  }

  async truncate(model, options = {}) {
    const { tableName } = this._schema(model);
    this._db().prepare(`DELETE FROM "${tableName}"`).run();
    this._db().prepare(`DELETE FROM sqlite_sequence WHERE name="${tableName}"`).run();
  }
}
