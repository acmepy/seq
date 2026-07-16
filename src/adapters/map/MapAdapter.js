import { BaseAdapter } from '../BaseAdapter.js';
import { MapDDL } from './MapDDL.js';
import { MapDML } from './MapDML.js';
import { MapDCL } from './MapDCL.js';
import { MapTCL } from './MapTCL.js';
import { clone } from '../../utils/clone.js';

/**
 * In-memory adapter using Map collections.
 * Structure: Map<tableName, Map<primaryKey, record>>
 */
export class MapAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ fkStrategy: 'none', ...options });
    /** @type {Map<string, Map<*|null, object>>} */
    this.database = new Map();
    /** @type {Map<string, number>} */
    this.sequences = new Map();

    this.ddl = new MapDDL(this);
    this.dml = new MapDML(this);
    this.dcl = new MapDCL(this);
    this.tcl = new MapTCL(this);
  }

  /**
   * Initializes the adapter (no-op for in-memory).
   */
  async initialize() {}

  /**
   * Returns metadata about the virtual database.
   * @returns {Promise<object>}
   */
  async inspectDatabase() {
    return {
      tables: [...this.schemas.keys()],
      schemas: Object.fromEntries(this.schemas),
      recordCounts: Object.fromEntries(
        [...this.database.entries()].map(([name, table]) => [name, table.size])
      )
    };
  }

  /**
   * Maps an abstract DataType to a string representation.
   * @param {import('../../data-types/AbstractDataType.js').AbstractDataType} dataType
   * @returns {string}
   */
  mapDataType(dataType) {
    return dataType.toString();
  }

  /**
   * Clones a record for safe external access.
   * @param {object} record
   * @returns {object}
   */
  cloneRecord(record) {
    return clone(record);
  }
}
