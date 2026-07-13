import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * Base DDL abstract.
 * Defines the full DDL contract and provides adapter-agnostic helpers.
 * Orchestrates createTable/alterTable in ordered phases.
 * Adapter-specific subclasses must implement the low-level methods.
 */
export class DDLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Orchestration — ordered DDL phases
  // ---------------------------------------------------------------------------

  /**
   * Creates a new table, processing constraints in order:
   * 1. CREATE TABLE (columns + PK)
   * 2. ADD UNIQUE constraints
   * 3. CREATE INDEX
   * 4. ADD FOREIGN KEY
   * @param {object} definition - Table definition
   * @param {object} [options]
   */
  async createTable(definition, options = {}) {
    const def = this.normalizeDefinition(definition);
    await this.createTableStructure(def);
    for (const uk of def.uniqueConstraints) {
      await this.addUniqueConstraint(def.tableName, uk);
    }
    for (const idx of def.indexes) {
      await this.createIndex(def.tableName, idx);
    }
    for (const fk of def.foreignKeys) {
      await this.addForeignKey(def.tableName, fk);
    }
  }

  /**
   * Alters a table to match a new definition.
   * Adds missing columns, unique constraints, indexes, and foreign keys.
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

    const def = this.normalizeDefinition(definition);
    let hasChanges = false;

    const missing = this.diffColumns(schema, def);
    if (Object.keys(missing).length > 0) {
      await this.alterTableColumns(tableName, missing);
      hasChanges = true;
    }

    const existingUKNames = new Set(schema.uniqueConstraints.map(uk => uk.constraintName));
    for (const uk of def.uniqueConstraints) {
      if (!existingUKNames.has(uk.constraintName)) {
        await this.addUniqueConstraint(tableName, uk);
        hasChanges = true;
      }
    }

    const existingIdxNames = new Set(schema.indexes.map(idx => idx.name));
    for (const idx of def.indexes) {
      if (!existingIdxNames.has(idx.name)) {
        await this.createIndex(tableName, idx);
        hasChanges = true;
      }
    }

    const existingFKNames = new Set(schema.foreignKeys.map(fk => fk.constraintName));
    for (const fk of def.foreignKeys) {
      if (!existingFKNames.has(fk.constraintName)) {
        await this.addForeignKey(tableName, fk);
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Creates the base table structure (columns + primary key).
   * Does not add constraints — those are handled by createTable orchestration.
   * @param {object} def - Normalized definition
   */
  async createTableStructure(def) {
    throw new AdapterError('DDL createTableStructure is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
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
   * Lists all table names.
   * @returns {Promise<string[]>}
   */
  async listTables() {
    throw new AdapterError('DDL listTables is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Adds missing columns to an existing table and backfills defaults.
   * @param {string} tableName
   * @param {object} missingColumns - Map of column names to definitions
   */
  async alterTableColumns(tableName, missingColumns) {
    throw new AdapterError('DDL alterTableColumns is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Adds a UNIQUE constraint to a table.
   * @param {string} tableName
   * @param {object} constraint - { columns: string[], constraintName: string }
   */
  async addUniqueConstraint(tableName, constraint) {
    throw new AdapterError('DDL addUniqueConstraint is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Creates an index on a table.
   * @param {string} tableName
   * @param {object} index - { columns: string[], name: string, unique: boolean }
   */
  async createIndex(tableName, index) {
    throw new AdapterError('DDL createIndex is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Adds a foreign key constraint to a table.
   * @param {string} tableName
   * @param {object} fk - Foreign key definition
   */
  async addForeignKey(tableName, fk) {
    throw new AdapterError('DDL addForeignKey is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
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
      uniqueConstraints: [...(definition.uniqueConstraints || [])],
      indexes: [...(definition.indexes || [])],
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
