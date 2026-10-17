import { BaseAdapter } from '../BaseAdapter.js';
import { Oracle11DDL } from './Oracle11DDL.js';
import { Oracle11DML } from './Oracle11DML.js';
import { Oracle11TCL } from './Oracle11TCL.js';
import { Oracle11Error } from './Oracle11Error.js';
import { truncateMiddle } from '../../utils/naming.js';
import util from 'node:util';
import { ConfigurationError } from '../../core/errors/ConfigurationError.js';

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
    this.booleanValues = this._validateBooleanValues(options.booleanValues);
    this._pool = null; this._connectionOptions = this._normalizeConnectionOptions(options);
    this.ddl = new Oracle11DDL(this); this.dml = new Oracle11DML(this); this.dcl = null; this.tcl = new Oracle11TCL(this);
  }
  static async _loadClient() {
    if (!util.isDate) util.isDate = value => value instanceof Date;
    if (!oracleClient) oracleClient = await import('oracledb');
    return oracleClient.default || oracleClient;
  }

  async validateDependencies() {
    const client = await this._getClient();
    this._validateClientVersion(client);
    return true;
  }
  
  async connect() { 
    if (this._pool) return; 
    this._client = await this._getClient(); 
    this._pool = await this._client.createPool(this._connectionOptions); 
    this._log('info', 'conectado'); 
  }
  
  async authenticate() { 
    await this.connect(); 
    await this.dml._executeGet('SELECT 1 AS ok FROM dual'); 
    return true; 
  }
  
  async close() { 
    if (this._activeTransaction) await this.tcl.rollback(this._activeTransaction); 
    if (this._pool) { 
      await this._pool.close(0); 
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
  
  async _withConnection(run) {
    if (this._activeTransaction) return run(this._activeTransaction.connection);
    const connection = await this._pool.getConnection();
    try { 
      return await run(connection); 
    } catch(e){
      throw Oracle11Error.from(e);
    }finally { 
      await connection.close(); 
    }
  }
  sequenceName(tableName) { const prefix = 'seq_'; const safe = String(tableName).replace(/[^A-Za-z0-9_$#]/g, '_'); return `${prefix}${safe}`.slice(0, 30); }

  _validateBooleanValues(values) {
    if (values === undefined) return undefined;
    const valid = value => (typeof value === 'string' && value.trim().length > 0 && value.length <= 4000)
      || (typeof value === 'number' && Number.isFinite(value));
    if (!values || !valid(values.true) || !valid(values.false)
      || typeof values.true !== typeof values.false
      || this._booleanKey(values.true) === this._booleanKey(values.false)) {
      throw new ConfigurationError('booleanValues requires distinct true and false values, both non-empty strings or finite numbers', { code: 'SEQ_ORACLE_INVALID_BOOLEAN_VALUES' });
    }
    return { true: values.true, false: values.false };
  }

  _booleanKey(value) { return String(value).trim().toUpperCase(); }

  booleanValuesFor(column) { return column?.booleanValues ?? this.booleanValues ?? { true: 1, false: 0 }; }

  serializeBoolean(value, column) {
    if (typeof value !== 'boolean') return value;
    return this.booleanValuesFor(column)[value ? 'true' : 'false'];
  }

  deserializeBoolean(value, column) {
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    const values = this.booleanValuesFor(column);
    const key = this._booleanKey(value);
    if (key === this._booleanKey(values.true)) return true;
    if (key === this._booleanKey(values.false)) return false;
    return value === 1 || (typeof value === 'string' && ['1', 'S', 'Y', 'TRUE'].includes(key));
  }

  buildTableDefinition(modelClass, context) {
    const definition = super.buildTableDefinition(modelClass, context);
    for (const [attr, column] of Object.entries(definition.columns)) {
      const values = modelClass.rawAttributes[attr]?.booleanValues;
      if (values !== undefined) {
        if (column.type?.constructor?.name !== 'BooleanType') {
          throw new ConfigurationError('booleanValues can only be used with BOOLEAN attributes', { code: 'SEQ_ORACLE_INVALID_BOOLEAN_VALUES' });
        }
        column.booleanValues = this._validateBooleanValues(values);
      }
    }
    return definition;
  }

  mapDataType(dataType, column) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'NUMBER(10)';
      case 'DecimalType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 2})`;
      case 'NumberType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 0})`;
      case 'StringType': return `VARCHAR2(${Math.min(dataType.options?.length ?? 255, 4000)})`;
      case 'BooleanType': {
        const values = this.booleanValuesFor(column);
        return typeof values.true === 'string'
          ? `VARCHAR2(${Math.max(values.true.length, values.false.length)} CHAR)`
          : (column?.booleanValues || this.booleanValues ? 'NUMBER' : 'NUMBER(1)');
      }
      case 'DateType': return 'DATE';
      case 'ArrayType': case 'ObjectType': case 'JSONType': return 'VARCHAR2(4000)';
      default: return 'VARCHAR2(4000)';
    }
  }
  cloneRecord(record) { return { ...record }; }
  async _getClient() { try { return await this.constructor._loadClient(); } catch (error) { const wrapped = Oracle11Error.missingDependency(error); this._dependencyWarning(wrapped.message); throw wrapped; } }
  _validateClientVersion(client) {
    const version = client?.versionString || this._versionNumberToString(client?.version);
    if (!version || this._compareVersions(version, '5.5.0') <= 0) return;
    const error = Oracle11Error.unsupportedDependencyVersion(version);
    this._dependencyWarning(error.message);
    throw error;
  }
  _versionNumberToString(version) {
    if (!Number.isInteger(version)) return null;
    const major = Math.floor(version / 10000);
    const minor = Math.floor((version % 10000) / 100);
    const patch = version % 100;
    return `${major}.${minor}.${patch}`;
  }
  _compareVersions(left, right) {
    const a = String(left).split('.').map(value => Number.parseInt(value, 10) || 0);
    const b = String(right).split('.').map(value => Number.parseInt(value, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  _dependencyWarning(message) { if (this._seq) this._log('error', message); else console.error(`[Seq] ${message}`); }
  _normalizeConnectionOptions(options) {
    const { naming, fkStrategy, eager, booleanValues, afterConnect, connectString, user, password, poolMin, poolMax, poolIncrement, ...rest } = options;
    if (afterConnect !== undefined) {
      if (typeof afterConnect !== 'function') {
        throw new ConfigurationError('afterConnect must be a function', { code: 'SEQ_ORACLE_INVALID_AFTER_CONNECT' });
      }
      if (rest.sessionCallback !== undefined) {
        throw new ConfigurationError('afterConnect cannot be combined with sessionCallback', { code: 'SEQ_ORACLE_INVALID_AFTER_CONNECT' });
      }
      // oracledb 5.5 invokes sessionCallback for new sessions and awaits done().
      rest.sessionCallback = (connection, requestedTag, done) => {
        Promise.resolve().then(() => afterConnect(connection)).then(
          () => done(),
          error => done(error instanceof Error ? error : new Error('Oracle afterConnect failed', { cause: error }))
        );
      };
    }
    return { user, password, connectString, poolMin: poolMin ?? 0, poolMax: poolMax ?? 4, poolIncrement: poolIncrement ?? 1, ...rest };
  }
}
