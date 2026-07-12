import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * DDL operations for the MapAdapter.
 * Handles table creation, dropping, inspection and alteration.
 */
export class MapDDL {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    this._adapter = adapter;
  }

  /**
   * Creates a new table.
   * @param {object} definition - Table definition
   * @param {object} [options]
   */
  async createTable(definition, options = {}) {
    const { tableName, columns, primaryKey, autoIncrement, timestamps, createdAt, updatedAt, attrToColumn, columnToAttr, primaryKeyAttribute, autoIncrementAttribute } = definition;

    if (this._adapter.database.has(tableName)) {
      throw new AdapterError(`Table "${tableName}" already exists`, {
        code: 'SEQ_ADAPTER_TABLE_EXISTS'
      });
    }

    this._adapter.database.set(tableName, new Map());
    this._adapter.schemas.set(tableName, {
      tableName,
      columns: { ...columns },
      primaryKey: primaryKey || null,
      autoIncrement: autoIncrement || null,
      primaryKeyAttribute: primaryKeyAttribute || null,
      autoIncrementAttribute: autoIncrementAttribute || null,
      timestamps: timestamps || false,
      createdAt: createdAt || 'createdAt',
      updatedAt: updatedAt || 'updatedAt',
      attrToColumn: attrToColumn || {},
      columnToAttr: columnToAttr || {}
    });
    this._adapter.sequences.set(tableName, 1);
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

    let altered = false;
    const newColumns = definition.columns || {};

    for (const [name, colDef] of Object.entries(newColumns)) {
      if (!(name in schema.columns)) {
        schema.columns[name] = colDef;
        altered = true;
        // Add default value to existing records
        const table = this._adapter.database.get(tableName);
        for (const [, record] of table) {
          if (!(name in record)) {
            record[name] = colDef.defaultValue !== undefined
              ? (typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue)
              : null;
          }
        }
      }
    }

    return altered;
  }

  /**
   * Lists all table names.
   * @returns {Promise<string[]>}
   */
  async listTables() {
    return [...this._adapter.database.keys()];
  }
}
