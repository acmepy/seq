import { AdapterError } from '../../core/errors/AdapterError.js';
import { DDLAbstract } from '../abstract/DDLAbstract.js';

/**
 * DDL operations for the MapAdapter.
 * Implements low-level table operations; orchestration lives in DDLAbstract.
 */
export class MapDDL extends DDLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  // ---------------------------------------------------------------------------
  // Low-level implementations — called by DDLAbstract orchestration
  // ---------------------------------------------------------------------------

  async createTableStructure(def) {
    if (this._adapter.database.has(def.tableName)) {
      throw new AdapterError(`Table "${def.tableName}" already exists`, {
        code: 'SEQ_ADAPTER_TABLE_EXISTS'
      });
    }

    this._adapter.database.set(def.tableName, new Map());
    this._adapter.sequences.set(def.tableName, 1);
    this._adapter.schemas.set(def.tableName, {
      modelName: def.modelName,
      tableName: def.tableName,
      columns: def.columns,
      primaryKey: def.primaryKey,
      autoIncrement: def.autoIncrement,
      primaryKeyAttribute: def.primaryKeyAttribute,
      autoIncrementAttribute: def.autoIncrementAttribute,
      timestamps: def.timestamps,
      createdAt: def.createdAt,
      updatedAt: def.updatedAt,
      attrToColumn: def.attrToColumn,
      columnToAttr: def.columnToAttr,
      uniqueConstraints: [],
      indexes: [],
      foreignKeys: []
    });
  }

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

  async hasTable(tableName) {
    return this._adapter.database.has(tableName);
  }

  async describeTable(tableName) {
    if (!this._adapter.schemas.has(tableName)) {
      throw new AdapterError(`Table "${tableName}" does not exist`, {
        code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'
      });
    }
    return { ...this._adapter.schemas.get(tableName) };
  }

  async alterTableColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      schema.columns[name] = colDef;
    }
    const table = this._adapter.database.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      for (const [, record] of table) {
        if (!(name in record)) {
          record[name] = colDef.defaultValue !== undefined
            ? (typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue)
            : null;
        }
      }
    }
  }

  async listTables() {
    return [...this._adapter.database.keys()];
  }

  async addUniqueConstraint(tableName, constraint) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    schema.uniqueConstraints.push({ ...constraint });
  }

  async createIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    schema.indexes.push({ ...index });
  }

  async addForeignKey(tableName, fk) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    schema.foreignKeys.push({ ...fk });
  }
}
