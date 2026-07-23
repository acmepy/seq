/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
export class BaseAdapter {
  static defaultNaming = {
    tables: undefined,
    columns: undefined,
    prefix: undefined,
    caseStyle: undefined
  };

  /**
   * @param {object} [options]
   * @param {object} [options.naming]
   * @param {'alter'|'inline'|'none'} [options.fkStrategy]
   * @param {boolean} [options.eager]
   */
  constructor(options = {}) {
    const defaultNaming = this.constructor.defaultNaming || BaseAdapter.defaultNaming;
    this._naming = { ...BaseAdapter.defaultNaming, ...defaultNaming, ...(options.naming || {}) };
    this.options = { ...options, naming: this._naming };
    this._fkStrategy = options.fkStrategy !== undefined ? options.fkStrategy : 'alter';
    this._eager = options.eager !== undefined ? options.eager : false;
    this.schemas = new Map();
    this.ddl = null;
    this.dml = null;
    this.dcl = null;
    this.tcl = null;
    this._activeTransaction = null;
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
    if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) {
      throw new TypeError('SQL identifiers must be non-empty strings without null bytes');
    }
    return `"${name.replaceAll('"', '""')}"`;
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
   * Returns the naming policy for physical table and column names.
   * @returns {object}
   */
  get naming() {
    return this._naming;
  }

  /**
   * Normalizes a value for storage.
   * @param {import('../../types/index.d.ts').AttributeDefinition} attribute - The attribute definition
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
