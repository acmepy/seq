import { DDLAbstract } from '../abstract/DDLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

export class SQLiteDDL extends DDLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async createTableStructure(def) {
    const colDefs = [];
    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const colName = colDef.field || attrName;
      const parts = [colName];
      parts.push(this._adapter.mapDataType(colDef.type));
      if (colDef.primaryKey && !def.autoIncrement) parts.push('PRIMARY KEY');
      if (colDef.autoIncrement) parts.push('PRIMARY KEY AUTOINCREMENT');
      if (!colDef.allowNull && !colDef.primaryKey) parts.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null) {
        const dv = typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue;
        if (dv instanceof Date) {
          parts.push(`DEFAULT '${dv.toISOString()}'`);
        } else if (typeof dv === 'string') {
          parts.push(`DEFAULT '${dv}'`);
        } else if (Array.isArray(dv) || (typeof dv === 'object')) {
          parts.push(`DEFAULT '${JSON.stringify(dv)}'`);
        } else {
          parts.push(`DEFAULT ${dv}`);
        }
      }
      colDefs.push(parts.join(' '));
    }

    for (const fk of (def.foreignKeys || [])) {
      if (this._adapter.fkStrategy !== 'inline') continue;
      const refTable = fk.references.table;
      const refCol = fk.references.column;
      const colName = fk.columnName;
      const fkName = fk.constraintName;
      const onDelete = fk.onDelete || 'RESTRICT';
      const onUpdate = fk.onUpdate || 'RESTRICT';
      colDefs.push(`CONSTRAINT "${fkName}" FOREIGN KEY ("${colName}") REFERENCES "${refTable}" ("${refCol}") ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
      const schema = this._adapter.schemas.get(def.tableName);
      schema.foreignKeys.push({ ...fk });
    }

    const sql = `CREATE TABLE "${def.tableName}" (\n  ${colDefs.join(',\n  ')}\n)`;
    this._db().prepare(sql).run();
  }

  async dropTable(tableName, options = {}) {
    this._db().prepare(`DROP TABLE IF EXISTS "${tableName}"`).run();
    await super.dropTable(tableName, options);
  }

  async hasTable(tableName) {
    const row = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return !!row;
  }

  async describeTable(tableName) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema)  throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    return { ...schema };
  }

  async listTables() {
    const rows = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    return rows.map(r => r.name);
  }

  async addForeignKey(tableName, fk) {
    if (this._adapter.fkStrategy === 'alter') super.addForeignKey(tableName, fk);
  }
}
