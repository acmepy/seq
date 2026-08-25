/**
 * Base class for abstract adapter groups.
 */
export class BaseAbstract {
  constructor(adapter) {
    this._adapter = adapter;
  }

  _log(...args) {
    this._adapter?._log(...args);
  }

  /**
   * Executes a SQL callback and logs its duration. The SQL and parameters stay
   * as the first two log values for compatibility with existing log handlers.
   * @param {string} sql
   * @param {*[]} params
   * @param {Function} execute
   * @returns {*}
   */
  _measureSql(sql, params = [], execute) {
    const loggedSql = sql.replace(/\s+/g, ' ').trim();
    const startedAt = performance.now();
    const finish = (level, error) => {
      const sqlDurationMs = performance.now() - startedAt;
      this._log(level, loggedSql, params, {
        type: 'sql',
        sqlDurationMs,
        error: error ? { name: error.name, message: error.message, code: error.code } : undefined
      });
    };
    const success = result => {
      finish(this._adapter?._seq?._isSlowQuery(performance.now() - startedAt) ? 'warn' : 'trace');
      return result;
    };
    const failure = error => {
      finish('error', error);
      throw error;
    };

    try {
      const result = execute();
      return result && typeof result.then === 'function' ? result.then(success, failure) : success(result);
    } catch (error) {
      return failure(error);
    }
  }
}
