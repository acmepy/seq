import { BaseAdapter } from '../BaseAdapter.js';
import { MySQLDDL } from './MySQLDDL.js';
import { MySQLDML } from './MySQLDML.js';
import { MySQLTCL } from './MySQLTCL.js';
import { MySQLError } from './MySQLError.js';

let mysqlClient = null;

export class MySQLAdapter extends BaseAdapter {
  static defaultNaming = {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: undefined,
    caseStyle: 'lower'
  };

  constructor(options = {}) {
    super({ fkStrategy: 'alter', ...options });
    this._pool = null;
    this._connectionOptions = this._normalizeConnectionOptions(options);
    this.ddl = new MySQLDDL(this);
    this.dml = new MySQLDML(this);
    this.dcl = null;
    this.tcl = new MySQLTCL(this);
  }

  static async _loadClient() {
    if (!mysqlClient) mysqlClient = await import('mysql2/promise');
    return mysqlClient;
  }

  async validateDependencies() {
    await this._getClient();
    return true;
  }

  async connect() {
    if (this._pool) return;
    const mysql = await this._getClient();
    this._pool = mysql.createPool(this._connectionOptions);
    this._log('info', 'conectado');
  }

  async authenticate() {
    await this.connect();
    await this.dml._executeGet('SELECT 1 AS ok', []);
    return true;
  }

  async close() {
    if (this._activeTransaction) await this.tcl.rollback(this._activeTransaction);
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
      this._log('info', 'desconectado');
    }
  }

  async initialize() {
    if (!this._pool) await this.connect();
  }

  _connection() {
    return this._activeTransaction?.connection || this._pool;
  }

  _quoteIdentifier(name) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) {
      throw new TypeError('SQL identifiers must be non-empty strings without null bytes');
    }
    return `\`${name.replaceAll('`', '``')}\``;
  }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'INTEGER';
      case 'DecimalType': {
        const precision = dataType.options?.precision ?? 10;
        const scale = dataType.options?.scale ?? 2;
        return `DECIMAL(${precision}, ${scale})`;
      }
      case 'NumberType': return 'DOUBLE';
      case 'StringType': return `VARCHAR(${dataType.options?.length ?? 255})`;
      case 'BooleanType': return 'TINYINT(1)';
      case 'DateType': return 'DATETIME(3)';
      case 'ArrayType':
      case 'ObjectType':
      case 'JSONType': return 'JSON';
      default: return 'TEXT';
    }
  }

  cloneRecord(record) {
    return { ...record };
  }

  async _getClient() {
    try {
      return await this.constructor._loadClient();
    } catch (error) {
      const mysqlError = MySQLError.missingDependency('mysql2', error);
      this._dependencyWarning(mysqlError.message);
      throw mysqlError;
    }
  }

  _dependencyWarning(message) {
    if (this._seq) {
      this._log('error', message);
      return;
    }
    console.error(`[Seq] ${message}`);
  }

  _normalizeConnectionOptions(options) {
    const {
      naming,
      fkStrategy,
      eager,
      ...connectionOptions
    } = options;
    return {
      host: 'localhost',
      port: 3306,
      user: 'root',
      database: 'seq',
      waitForConnections: true,
      connectionLimit: 10,
      timezone: 'Z',
      supportBigNumbers: true,
      ...connectionOptions
    };
  }
}
