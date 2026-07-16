/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
export class BaseAdapter {
  constructor(options = {}) {
    this.options = options;
    this._caseStyle = options.caseStyle !== undefined ? options.caseStyle : 'lower';
    this._fkStrategy = options.fkStrategy !== undefined ? options.fkStrategy : 'alter';
    this._eager = options.eager !== undefined ? options.eager : false;
    this.schemas = new Map();
    this.ddl = null;
    this.dml = null;
    this.dcl = null;
    this.tcl = null;
  }

  /**
   * Connects to the data source (no-op for in-memory adapters).
   */
  async connect() {}

  /**
   * Validates that the data source is reachable.
   * Adapters with a real connection should override this with a lightweight query.
   * @returns {Promise<boolean>}
   */
  async authenticate() {
    await this.connect();
    return true;
  }

  /**
   * Closes the connection (no-op for in-memory adapters).
   */
  async close() {}

  /**
   * Initializes the adapter.
   */
  async initialize() {}

  /**
   * Inspects the virtual database and returns metadata.
   * @returns {Promise<object>}
   */
  async inspectDatabase() {
    return { tables: [] };
  }

  /**
   * Maps an abstract DataType to a native type string.
   * @param {import('../data-types/AbstractDataType.js').AbstractDataType} dataType
   * @returns {string}
   */
  mapDataType(dataType) {
    return dataType.toString();
  }

  /**
   * Quotes a SQL identifier (table, column, index, constraint name).
   * Default uses double quotes (standard SQL). Override for adapter-specific quoting.
   * MySQL: `\`${name}\``, SQL Server: `[${name}]`
   * @param {string} name - The identifier to quote
   * @returns {string}
   */
  _quoteIdentifier(name) {
    return `"${name}"`;
  }

  /**
   * Returns the case style for identifiers (table/column names).
   * Subclasses can override to return 'upper' for databases like Oracle.
   * @returns {string} 'lower' | 'upper' | undefined
   */
  get caseStyle() {
    return this._caseStyle;
  }

  /**
   * Returns the FK creation strategy for this adapter.
   * - 'alter': FKs created via ALTER TABLE ADD CONSTRAINT (default for most DBs)
   * - 'inline': FKs included in CREATE TABLE statement (SQLite)
   * - 'none': no physical FK creation (in-memory adapters)
   * @returns {string} 'alter' | 'inline' | 'none'
   */
  get fkStrategy() {
    return this._fkStrategy;
  }

  /**
   * Returns the default include loading strategy for this adapter.
   * Query-level `eager` and include-level `eager` can override this value.
   * @returns {boolean}
   */
  get eager() {
    return this._eager;
  }

  /**
   * Normalizes a value for storage.
   * @param {object} attribute - The attribute definition
   * @param {*} value - The value to normalize
   * @returns {*}
   */
  normalizeValue(attribute, value) {
    return value;
  }

  /**
   * Logs through the owning Seq instance when logging is enabled.
   */
  _log(...args) {
    this._seq?._log(...args);
  }
}
