import { BaseAdapter } from '../BaseAdapter.js';
import { SQLiteDDL } from './SQLiteDDL.js';
import { SQLiteDML } from './SQLiteDML.js';
import { SQLiteTCL } from './SQLiteTCL.js';
import { SQLiteError } from './SQLiteError.js';
import { applyCase, applyConvention } from '../../utils/naming.js';

let Database = null;

export class SQLiteAdapter extends BaseAdapter {
  static defaultNaming = {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: undefined,
    caseStyle: 'lower'
  };

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
    if (this._db) return;
    const DatabaseConstructor = await this._getDatabaseConstructor();
    this._db = new DatabaseConstructor(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._log('info', 'conectado');
  }

  async authenticate() {
    await this.connect();
    await this.dml._executeGet('SELECT 1 AS ok', []);
    return true;
  }

  async validateDependencies() {
    await this._getDatabaseConstructor();
    return true;
  }

  async _getDatabaseConstructor() {
    try {
      return await this.constructor._loadDatabase();
    } catch (error) {
      const sqliteError = SQLiteError.missingDependency('better-sqlite3', error);
      this._dependencyWarning(sqliteError.message);
      throw sqliteError;
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
