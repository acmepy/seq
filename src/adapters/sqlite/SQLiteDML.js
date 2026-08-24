import { DMLAbstract } from "../abstract/DMLAbstract.js";
import { AdapterError } from '../../core/errors/AdapterError.js';
import { SQLiteError } from './SQLiteError.js';

export class SQLiteDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  _throwLoggedError(error) {
    const sqliteError = SQLiteError.from(error);
    this._log('error', sqliteError.message);
    throw sqliteError;
  }

  // ---------------------------------------------------------------------------
  // Execution hooks — SQLite-specific
  // ---------------------------------------------------------------------------

  async _executeQueryAll(sql, params) {
    this._log('trace', sql, params);
    try {
      return this._db().prepare(sql).all(...params);
    } catch (error) {
      this._throwLoggedError(error);
    }
  }

  async _executeGet(sql, params) {
    this._log('trace', sql, params);
    try {
      return this._db().prepare(sql).get(...params);
    } catch (error) {
      this._throwLoggedError(error);
    }
  }

  _execute(sql, params = []) {
    this._log('trace', sql, params);
    try {
      return this._db().prepare(sql).run(...params);
    } catch (error) {
      this._throwLoggedError(error);
    }
  }

  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }

  // ---------------------------------------------------------------------------
  // Serialization — SQLite-specific type handling
  // ---------------------------------------------------------------------------

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
      } else if (typeName === 'DateType') {
        if (value instanceof Date) result[attrName] = value;
        else if (typeof value === 'string') {
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) throw new AdapterError(`Invalid date stored in column "${key}"`, {
            code: 'SEQ_ADAPTER_INVALID_STORED_VALUE', details: { column: key, value }
          });
          result[attrName] = date;
        }
        else result[attrName] = value;
      } else {
        result[attrName] = value;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Adapter-specific methods — truncate
  // ---------------------------------------------------------------------------

  async bulkInsert(model, records, options = {}) {
    this._assertTransaction(options);
    if (records.length === 0) return [];

    const { tableName, schema } = this._schema(model);
    const insertOne = (values) => {
      const colRecord = this._toColumnNames(values, schema);
      this._applyDefaults(colRecord, schema);
      this._applyTimestamps(colRecord, schema);
      if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];
      this._validateRecord(colRecord, schema, model.modelName);

      const cols = Object.keys(colRecord);
      const colNames = cols.map(c => this._q(c)).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
      const params = cols.map(c => this._serializeValue(colRecord[c]));
      const info = this._execute(sql, params);

      if (schema.primaryKey && !colRecord[schema.primaryKey]) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      const attrRecord = this._toAttrNames(colRecord, schema);
      return new model(attrRecord, { _isNew: false });
    };

    const insertMany = this._db().transaction(items => items.map(insertOne));
    return insertMany(records);
  }
/* ver para refactorizar y usar
  async upsert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const conflictFields = this._resolveUpsertConflictFields(model, values, options, schema);

    // SQLite only accepts ON CONFLICT targets backed by a real PRIMARY KEY or UNIQUE constraint.
    // Arbitrary where clauses still use the adapter-agnostic select/update/insert fallback.
    if (conflictFields.length === 0 || !this._isNativeConflictTarget(conflictFields, schema)) {
      return super.upsert(model, values, options);
    }

    // Read first so the public return value can include the "created" flag.
    const where = this._resolveUpsertWhere(model, values, options, schema);
    const existing = await this.selectOne(model, { where, transaction: options.transaction });
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];

    try {
      this._validateRecord(colRecord, schema, model.modelName);
    } catch (error) {
      if (existing) return super.upsert(model, values, options);
      throw error;
    }

    const cols = Object.keys(colRecord);
    if (cols.length === 0) return super.upsert(model, values, options);

    const conflictCols = conflictFields.map(field => schema.attrToColumn[field] || field);
    const createdCol = schema.timestamps ? (schema.attrToColumn[schema.createdAt] || schema.createdAt) : null;
    const updateCols = cols.filter(col => !conflictCols.includes(col) && col !== schema.autoIncrement && col !== createdCol);

    // Builds:
    // INSERT INTO table (...) VALUES (...)
    // ON CONFLICT (...) DO UPDATE SET col = excluded.col
    const assignments = updateCols.length > 0
      ? updateCols.map(col => `${this._q(col)} = excluded.${this._q(col)}`)
      : [`${this._q(conflictCols[0])} = excluded.${this._q(conflictCols[0])}`];

    const sql = `INSERT INTO ${this._q(tableName)} (${cols.map(col => this._q(col)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (${conflictCols.map(col => this._q(col)).join(', ')}) DO UPDATE SET ${assignments.join(', ')}`;
    const params = cols.map(col => this._serializeValue(colRecord[col]));
    const info = await this._execute(sql, params);

    let resultWhere = where;
    if (!existing && schema.primaryKeyAttribute && !Object.prototype.hasOwnProperty.call(resultWhere, schema.primaryKeyAttribute) && info.lastInsertRowid) {
      resultWhere = { [schema.primaryKeyAttribute]: Number(info.lastInsertRowid) };
    }
    const instance = await this.selectOne(model, { where: resultWhere, transaction: options.transaction });
    return [instance || new model(this._toAttrNames(colRecord, schema), { _isNew: false }), !existing];
  }

  _isNativeConflictTarget(conflictFields, schema) {
    const conflictCols = conflictFields.map(field => schema.attrToColumn[field] || field);
    if (schema.primaryKey && conflictCols.length === 1 && conflictCols[0] === schema.primaryKey) return true;
    return (schema.uniqueConstraints || []).some(unique =>
      unique.columns.length === conflictCols.length
      && unique.columns.every((col, index) => col === conflictCols[index])
    );
  }
  */

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._execute(`DELETE FROM ${this._q(tableName)}`, []);
    await this._execute('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
  }
}
