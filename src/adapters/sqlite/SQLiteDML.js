import { DMLAbstract } from "../abstract/DMLAbstract.js";

export class SQLiteDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  // ---------------------------------------------------------------------------
  // Execution hooks — SQLite-specific
  // ---------------------------------------------------------------------------

  async _executeQueryAll(sql, params) {
    this._log('trace', sql, { sql, params });
    return this._db().prepare(sql).all(...params);
  }

  async _executeGet(sql, params) {
    this._log('trace', sql, { sql, params });
    return this._db().prepare(sql).get(...params);
  }

  _execute(sql, params = []) {
    this._log('trace', sql, { sql, params });
    return this._db().prepare(sql).run(...params);
  }

  _mapRows(rows, model, schema) {
    return rows.map(row => new model(this._toAttrNames(row, schema), { _isNew: false }));
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
        else if (typeof value === 'string') result[attrName] = new Date(value);
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
    if (records.length === 0) return [];

    const { tableName, schema } = this._schema(model);
    const insertOne = (values) => {
      const colRecord = this._toColumnNames(values, schema);
      this._applyDefaults(colRecord, schema);
      this._applyTimestamps(colRecord, schema);
      if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) {
        delete colRecord[schema.autoIncrement];
      }
      this._validateRecord(colRecord, schema, model.modelName);

      const cols = Object.keys(colRecord);
      const colNames = cols.map(c => this._q(c)).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
      const params = cols.map(c => this._serializeValue(colRecord[c]));
      const info = this._execute(sql, params);

      if (schema.primaryKey && !colRecord[schema.primaryKey]) {
        colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      }
      const attrRecord = this._toAttrNames(colRecord, schema);
      return new model(attrRecord, { _isNew: false });
    };

    const insertMany = this._db().transaction(items => items.map(insertOne));
    return insertMany(records);
  }

  async truncate(model, options = {}) {
    const { tableName } = this._schema(model);
    await this._execute(`DELETE FROM ${this._q(tableName)}`, []);
    await this._execute('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
  }
}
