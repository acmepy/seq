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
  }

  async dropTable(tableName, options = {}) {
    if (!this._adapter.database.has(tableName)) throw new AdapterError(`Table "${tableName}" does not exist`, {code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'});
    await super.dropTable(tableName, options);
    this._adapter.database.delete(tableName);
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

  async addColumns(tableName, missingColumns) {
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
    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    schema.uniqueConstraints.push({ ...constraint });
  }

  async addIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    schema.indexes.push({ ...index });
  }
}
