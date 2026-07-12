/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
export class BaseAdapter {
  constructor(options = {}) {
    this.options = options;
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
   * Normalizes a value for storage.
   * @param {object} attribute - The attribute definition
   * @param {*} value - The value to normalize
   * @returns {*}
   */
  normalizeValue(attribute, value) {
    return value;
  }
}
