import Database from 'better-sqlite3';
import { BaseAdapter } from '../BaseAdapter.js';
import { SQLiteDDL } from './SQLiteDDL.js';
import { SQLiteDML } from './SQLiteDML.js';
import { SQLiteTCL } from './SQLiteTCL.js';

export class SQLiteAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
    this._db = null;
    this._dbPath = options.database || ':memory:';
    this.ddl = new SQLiteDDL(this);
    this.dml = new SQLiteDML(this);
    this.dcl = null;
    this.tcl = new SQLiteTCL(this);
  }

  get caseStyle() {
    return 'lower';
  }

  get fkStrategy() {
    return 'inline';
  }

  async connect() {
    this._db = new Database(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  async initialize() {
    if (!this._db) await this.connect();
  }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'INTEGER';
      case 'DecimalType':
      case 'NumberType': return 'REAL';
      case 'StringType': return 'TEXT';
      case 'BooleanType': return 'INTEGER';
      case 'DateType': return 'TEXT';
      case 'ArrayType':
      case 'ObjectType':
      case 'JSONType': return 'TEXT';
      default: return 'TEXT';
    }
  }

  cloneRecord(record) {
    return { ...record };
  }
}
