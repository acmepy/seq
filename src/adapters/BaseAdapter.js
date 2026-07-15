/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
export class BaseAdapter {
  constructor(options = {}) {
    this.options = options;
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
    return 'lower';
  }

  /**
   * Returns the FK creation strategy for this adapter.
   * - 'alter': FKs created via ALTER TABLE ADD CONSTRAINT (default for most DBs)
   * - 'inline': FKs included in CREATE TABLE statement (SQLite)
   * - 'none': no physical FK creation (in-memory adapters)
   * @returns {string} 'alter' | 'inline' | 'none'
   */
  get fkStrategy() {
    return 'alter';
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
}
