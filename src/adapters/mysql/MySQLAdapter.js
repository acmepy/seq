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
    caseStyle: 'lower',
    maxLength: 64
  };

  constructor(options = {}) {
    super({ fkStrategy: 'alter', ...options });
    this._pool = null;
    this._configuredConnections = new WeakSet();
    this._sessionTimeouts = this._normalizeSessionTimeouts(options);
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

  async _acquireConnection() {
    await this.connect();
    let lastError;

    for (let attempt = 0; attempt < 2; attempt++) {
      const connection = await this._pool.getConnection();
      try {
        await this._configureConnection(connection);
        await this._measureSql('SELECT 1', [], () => connection.execute('SELECT 1'));
        return connection;
      } catch (error) {
        lastError = error;
        connection.destroy();
      }
    }

    throw lastError;
  }

  async _withConnection(run) {
    if (this._activeTransaction) return run(this._activeTransaction.connection);

    const connection = await this._acquireConnection();
    try {
      return await run(connection);
    } finally {
      connection.release();
    }
  }

  async _configureConnection(connection) {
    // mysql2/promise creates a lightweight PromisePoolConnection wrapper on
    // every checkout. The underlying PoolConnection is the physical session
    // whose server-side settings persist while it remains in the pool.
    const physicalConnection = connection.connection ?? connection;
    if (this._configuredConnections.has(physicalConnection)) return;
    const { waitTimeout, interactiveTimeout } = this._sessionTimeouts;
    await this._measureSql(`SET SESSION wait_timeout = ${waitTimeout}`, [], () => connection.execute(`SET SESSION wait_timeout = ${waitTimeout}`));
    await this._measureSql(`SET SESSION interactive_timeout = ${interactiveTimeout}`, [], () => connection.execute(`SET SESSION interactive_timeout = ${interactiveTimeout}`));
    this._configuredConnections.add(physicalConnection);
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
    const {naming, fkStrategy, eager, waitTimeout, interactiveTimeout, ...connectionOptions} = options;
    return {
      host: 'localhost', port: 3306, user: 'root', database: 'seq',
      waitForConnections: true, connectionLimit: 10, maxIdle: 10, idleTimeout: 60000,
      timezone: 'Z', supportBigNumbers: true, ...connectionOptions
    };
  }

  _normalizeSessionTimeouts(options) {
    return {
      waitTimeout: this._normalizeTimeout(options.waitTimeout ?? 300, 'waitTimeout'),
      interactiveTimeout: this._normalizeTimeout(options.interactiveTimeout ?? 300, 'interactiveTimeout')
    };
  }

  _normalizeTimeout(value, name) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer in seconds`);
    return value;
  }
}
