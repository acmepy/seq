import { DDLAbstract } from '../abstract/DDLAbstract.js';

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
      if (colDef.primaryKey && !def.autoIncrement) {
        parts.push('PRIMARY KEY');
      }
      if (colDef.autoIncrement) {
        parts.push('PRIMARY KEY AUTOINCREMENT');
      }
      if (!colDef.allowNull && !colDef.primaryKey) {
        parts.push('NOT NULL');
      }
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
      const refTable = fk.references.table;
      const refCol = fk.references.column;
      const colName = fk.columnName;
      const fkName = fk.constraintName;
      const onDelete = fk.onDelete || 'RESTRICT';
      const onUpdate = fk.onUpdate || 'RESTRICT';
      colDefs.push(`CONSTRAINT "${fkName}" FOREIGN KEY ("${colName}") REFERENCES "${refTable}" ("${refCol}") ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
    }

    const sql = `CREATE TABLE "${def.tableName}" (\n  ${colDefs.join(',\n  ')}\n)`;
    this._db().prepare(sql).run();
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
    this._db().prepare(`DROP TABLE IF EXISTS "${tableName}"`).run();
    this._adapter.schemas.delete(tableName);
  }

  async hasTable(tableName) {
    const row = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return !!row;
  }

  async describeTable(tableName) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      const { AdapterError } = await import('../../core/errors/AdapterError.js');
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    return { ...schema };
  }

  async alterTableColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      const colType = this._adapter.mapDataType(colDef.type);
      this._db().prepare(`ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${colType}`).run();
      schema.columns[name] = colDef;
    }
  }

  async listTables() {
    const rows = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    return rows.map(r => r.name);
  }

  async addUniqueConstraint(tableName, constraint) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = constraint.columns.join('", "');
    const sql = `CREATE UNIQUE INDEX "${constraint.constraintName}" ON "${tableName}" ("${cols}")`;
    this._db().prepare(sql).run();
    schema.uniqueConstraints.push({ ...constraint });
  }

  async createIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = index.columns.join('", "');
    const unique = index.unique ? 'UNIQUE ' : '';
    const sql = `CREATE ${unique}INDEX "${index.name}" ON "${tableName}" ("${cols}")`;
    this._db().prepare(sql).run();
    schema.indexes.push({ ...index });
  }

  async addForeignKey(tableName, fk) {
    const schema = this._adapter.schemas.get(tableName);
    schema.foreignKeys.push({ ...fk });
  }
}
