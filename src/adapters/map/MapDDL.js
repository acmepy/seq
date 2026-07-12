import { AdapterError } from '../../core/errors/AdapterError.js';
import { DDLAbstract } from '../abstract/DDLAbstract.js';

/**
 * DDL operations for the MapAdapter.
 * Handles table creation, dropping, inspection and alteration.
 *
 * Extends DDLStatements which provides adapter-agnostic helpers:
 * normalizeDefinition, diffColumns.
 */
export class MapDDL extends DDLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  /**
   * Creates a new table.
   * @param {object} definition - Table definition
   * @param {object} [options]
   */
  async createTable(definition, options = {}) {
    const def = this.normalizeDefinition(definition);

    if (this._adapter.database.has(def.tableName)) {
      throw new AdapterError(`Table "${def.tableName}" already exists`, {
        code: 'SEQ_ADAPTER_TABLE_EXISTS'
      });
    }

    this._adapter.database.set(def.tableName, new Map());
    this._adapter.schemas.set(def.tableName, def);
    this._adapter.sequences.set(def.tableName, 1);
  }

  /**
   * Drops a table.
   * @param {string} tableName
   * @param {object} [options]
   */
  async dropTable(tableName, options = {}) {
    if (!this._adapter.database.has(tableName)) {
      throw new AdapterError(`Table "${tableName}" does not exist`, {
        code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'
      });
    }
    this._adapter.database.delete(tableName);
    this._adapter.schemas.delete(tableName);
    this._adapter.sequences.delete(tableName);
  }

  /**
   * Checks if a table exists.
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async hasTable(tableName) {
    return this._adapter.database.has(tableName);
  }

  /**
   * Describes a table's schema.
   * @param {string} tableName
   * @returns {Promise<object>}
   */
  async describeTable(tableName) {
    if (!this._adapter.schemas.has(tableName)) {
      throw new AdapterError(`Table "${tableName}" does not exist`, {
        code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'
      });
    }
    return { ...this._adapter.schemas.get(tableName) };
  }

  /**
   * Alters a table to match a new definition.
   * Adds missing columns; does not drop or modify existing ones.
   * @param {string} tableName
   * @param {object} definition - New table definition
   * @param {object} [options]
   * @returns {Promise<boolean>} Whether any changes were made
   */
  async alterTable(tableName, definition, options = {}) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, {
        code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'
      });
    }

    const missing = this.diffColumns(schema, definition);
    const hasChanges = Object.keys(missing).length > 0;

    for (const [name, colDef] of Object.entries(missing)) {
      schema.columns[name] = colDef;
    }

    if (hasChanges) {
      const table = this._adapter.database.get(tableName);
      for (const [name, colDef] of Object.entries(missing)) {
        for (const [, record] of table) {
          if (!(name in record)) {
            record[name] = colDef.defaultValue !== undefined
              ? (typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue)
              : null;
          }
        }
      }
    }

    return hasChanges;
  }

  /**
   * Lists all table names.
   * @returns {Promise<string[]>}
   */
  async listTables() {
    return [...this._adapter.database.keys()];
  }
}
