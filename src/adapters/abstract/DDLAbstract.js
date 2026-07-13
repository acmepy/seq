import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * Base DDL abstract.
 * Defines the full DDL contract and provides adapter-agnostic helpers.
 * Adapter-specific subclasses must override all public methods.
 */
export class DDLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Creates a new table.
   * @param {object} definition - Table definition
   * @param {object} [options]
   */
  async createTable(definition, options = {}) {
    throw new AdapterError('DDL createTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Drops a table.
   * @param {string} tableName
   * @param {object} [options]
   */
  async dropTable(tableName, options = {}) {
    throw new AdapterError('DDL dropTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Checks if a table exists.
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async hasTable(tableName) {
    throw new AdapterError('DDL hasTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Describes a table's schema.
   * @param {string} tableName
   * @returns {Promise<object>}
   */
  async describeTable(tableName) {
    throw new AdapterError('DDL describeTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
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
    throw new AdapterError('DDL alterTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Lists all table names.
   * @returns {Promise<string[]>}
   */
  async listTables() {
    throw new AdapterError('DDL listTables is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Normalizes a table definition, filling in defaults for optional fields.
   * @param {object} definition
   * @returns {object} Normalized definition
   */
  normalizeDefinition(definition) {
    return {
      modelName: definition.modelName || null,
      tableName: definition.tableName,
      columns: { ...(definition.columns || {}) },
      foreignKeys: [...(definition.foreignKeys || [])],
      primaryKey: definition.primaryKey || null,
      autoIncrement: definition.autoIncrement || null,
      primaryKeyAttribute: definition.primaryKeyAttribute || null,
      autoIncrementAttribute: definition.autoIncrementAttribute || null,
      timestamps: definition.timestamps || false,
      createdAt: definition.createdAt || 'createdAt',
      updatedAt: definition.updatedAt || 'updatedAt',
      attrToColumn: definition.attrToColumn || {},
      columnToAttr: definition.columnToAttr || {}
    };
  }

  /**
   * Returns columns present in newDefinition but missing from existingSchema.
   * @param {object} existingSchema - Current schema stored by the adapter
   * @param {object} newDefinition - New table definition
   * @returns {object} Map of missing column names to their definitions
   */
  diffColumns(existingSchema, newDefinition) {
    const missing = {};
    const newColumns = newDefinition.columns || {};

    for (const [name, colDef] of Object.entries(newColumns)) {
      if (!(name in existingSchema.columns)) {
        missing[name] = colDef;
      }
    }

    return missing;
  }
}
