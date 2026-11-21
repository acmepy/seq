import { Oracle11Adapter } from '../oracle11/Oracle11Adapter.js';
import { ConfigurationError } from '../../core/errors/ConfigurationError.js';

/** Oracle 26ai using the current node-oracledb driver, including native Thin mode. */
export class Oracle26Adapter extends Oracle11Adapter {
  static async _loadClient() {
    const module = await import('oracledb');
    return module.default || module;
  }

  _validateClientVersion(client) {
    const version = client?.versionString || this._versionNumberToString(client?.version);
    if (version && this._compareVersions(version, '26.0.0') >= 0 && this._compareVersions(version, '27.0.0') < 0) return;
    throw new ConfigurationError('Oracle26Adapter requires oracledb 26.x', {
      code: 'SEQ_ORACLE26_UNSUPPORTED_DEPENDENCY_VERSION',
      details: { dependency: 'oracledb', version, required: '26.x' }
    });
  }

  async connect() {
    if (this._sessionInitializationError) throw this._sessionInitializationError;
    if (this._pool) return;
    await this.validateDependencies();
    return super.connect();
  }

  _normalizeConnectionOptions(options) {
    const normalized = super._normalizeConnectionOptions(options);
    const initialize = normalized.sessionCallback;
    if (typeof initialize !== 'function') return normalized;
    const adapter = this;
    normalized.sessionCallback = function (connection, tag, done) {
      const finish = error => {
        if (error) adapter._sessionInitializationError = error;
        done(error);
      };
      try {
        initialize.call(this, connection, tag, finish);
      } catch (error) {
        finish(error);
      }
    };
    return normalized;
  }

  async _withConnection(run) {
    if (this._sessionInitializationError) throw this._sessionInitializationError;
    return super._withConnection(connection => {
      if (this._sessionInitializationError) throw this._sessionInitializationError;
      return run(connection);
    });
  }

  async close() {
    await super.close();
    this._sessionInitializationError = null;
  }
}
