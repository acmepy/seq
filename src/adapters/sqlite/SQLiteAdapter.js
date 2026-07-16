import { BaseAdapter } from '../BaseAdapter.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { SQLiteDDL } from './SQLiteDDL.js';
import { SQLiteDML } from './SQLiteDML.js';
import { SQLiteTCL } from './SQLiteTCL.js';

let Database = null;

export class SQLiteAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ fkStrategy: 'inline', ...options });
    this._db = null;
    this._dbPath = options.database || ':memory:';
    this.ddl = new SQLiteDDL(this);
    this.dml = new SQLiteDML(this);
    this.dcl = null;
    this.tcl = new SQLiteTCL(this);
  }

  static async _loadDatabase() {
    if (!Database) {
      const module = await import('better-sqlite3');
      Database = module.default;
    }
    return Database;
  }

  async connect() {
    const DatabaseConstructor = await this._loadDatabaseDependency();
    this._db = new DatabaseConstructor(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._log('info', 'conectado');
  }

  async _loadDatabaseDependency() {
    try {
      return await this.constructor._loadDatabase();
    } catch (error) {
      const message = `
-------------------------------------------------------------------------------------------------------------

SQLiteAdapter requiere la dependencia "better-sqlite3". Instalala con: npm install better-sqlite3

-------------------------------------------------------------------------------------------------------------

`;
      this._dependencyWarning(message);
      throw new AdapterError(message, {
        code: 'SEQ_SQLITE_MISSING_DEPENDENCY',
        cause: error,
        details: { dependency: 'better-sqlite3' }
      });
    }
  }

  _dependencyWarning(message) {
    if (this._seq) {
      this._log('error', message);
      return;
    }
    console.error(`[Seq] ${message}`);
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._log('info', 'desconectado');
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
