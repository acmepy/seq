import { BaseAdapter } from '../BaseAdapter.js';
import { Oracle11DDL } from './Oracle11DDL.js';
import { Oracle11DML } from './Oracle11DML.js';
import { Oracle11TCL } from './Oracle11TCL.js';
import { Oracle11Error } from './Oracle11Error.js';
import util from 'node:util';

let oracleClient = null;

export class Oracle11Adapter extends BaseAdapter {
  static defaultNaming = { 
    tables: 'snake_case', 
    columns: 'snake_case', 
    prefix: undefined, 
    caseStyle: 'upper',
    maxLength: 30
  };
  constructor(options = {}) {
    super({ fkStrategy: 'alter', ...options });
    this._pool = null; this._connectionOptions = this._normalizeConnectionOptions(options);
    this.ddl = new Oracle11DDL(this); this.dml = new Oracle11DML(this); this.dcl = null; this.tcl = new Oracle11TCL(this);
  }
  static async _loadClient() {
    if (!util.isDate) util.isDate = value => value instanceof Date;
    if (!oracleClient) oracleClient = await import('oracledb');
    return oracleClient.default || oracleClient;
  }
  async validateDependencies() { await this._getClient(); return true; }
  async connect() { if (this._pool) return; this._client = await this._getClient(); this._pool = await this._client.createPool(this._connectionOptions); this._log('info', 'conectado'); }
  async authenticate() { await this.connect(); await this.dml._executeGet('SELECT 1 AS ok FROM dual'); return true; }
  async close() { if (this._activeTransaction) await this.tcl.rollback(this._activeTransaction); if (this._pool) { await this._pool.close(0); this._pool = null; this._log('info', 'desconectado'); } }
  async initialize() { if (!this._pool) await this.connect(); }
  _connection() { return this._activeTransaction?.connection || this._pool; }
  async _withConnection(run) {
    if (this._activeTransaction) return run(this._activeTransaction.connection);
    const connection = await this._pool.getConnection();
    try { 
      return await run(connection); 
    } catch(e){
      console.log('------------------>', e);
      throw Oracle11Error.from(e);
    }finally { 
      await connection.close(); 
    }
  }
  sequenceName(tableName) { const prefix = 'seq_'; const safe = String(tableName).replace(/[^A-Za-z0-9_$#]/g, '_'); return `${prefix}${safe}`.slice(0, 30); }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'NUMBER(10)';
      case 'DecimalType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 2})`;
      case 'NumberType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 0})`;
      case 'StringType': return `VARCHAR2(${Math.min(dataType.options?.length ?? 255, 4000)})`;
      case 'BooleanType': return 'NUMBER(1)';
      case 'DateType': return 'DATE';
      case 'ArrayType': case 'ObjectType': case 'JSONType': return 'VARCHAR2(4000)';
      default: return 'VARCHAR2(4000)';
    }
  }
  cloneRecord(record) { return { ...record }; }
  async _getClient() { try { return await this.constructor._loadClient(); } catch (error) { const wrapped = Oracle11Error.missingDependency(error); this._dependencyWarning(wrapped.message); throw wrapped; } }
  _dependencyWarning(message) { if (this._seq) this._log('error', message); else console.error(`[Seq] ${message}`); }
  _normalizeConnectionOptions(options) { const { naming, fkStrategy, eager, connectString, user, password, poolMin, poolMax, poolIncrement, ...rest } = options; return { user, password, connectString, poolMin: poolMin ?? 0, poolMax: poolMax ?? 4, poolIncrement: poolIncrement ?? 1, ...rest }; }
}
