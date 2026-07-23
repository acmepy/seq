import { DDLAbstract } from '../abstract/DDLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

export class SQLiteDDL extends DDLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async _execute(sql, params = []) {
    this._log('trace', sql.replaceAll('\n  ', ' '), params);
    this._db().prepare(sql).run(...params);
  }

  async createTableStructure(def) {
    const colDefs = [];
    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const colName = colDef.field || attrName;
      const parts = [this._q(colName)];
      parts.push(this._adapter.mapDataType(colDef.type));
      if (colDef.primaryKey && !def.autoIncrement) parts.push('PRIMARY KEY');
      if (colDef.autoIncrement) parts.push('PRIMARY KEY AUTOINCREMENT');
      if (!colDef.allowNull && !colDef.primaryKey) parts.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null && typeof colDef.defaultValue !== 'function') {
        parts.push(`DEFAULT ${this._literal(colDef.defaultValue)}`);
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
      colDefs.push(`CONSTRAINT ${this._q(fkName)} FOREIGN KEY (${this._q(colName)}) REFERENCES ${this._q(refTable)} (${this._q(refCol)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
      const schema = this._adapter.schemas.get(def.tableName);
      schema.foreignKeys.push({ ...fk });
    }

    const sql = `CREATE TABLE ${this._q(def.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
    await this._execute(sql);
  }

  async dropTable(tableName, options = {}) {
    await this.truncateTable(tableName, { ...options, ifExists: true, ignoreForeignKeys: true });
    await this._execute(`DROP TABLE IF EXISTS ${this._q(tableName)}`);
    await super.dropTable(tableName, options);
  }

  async truncateTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;

    const ignoreForeignKeys = options.ignoreForeignKeys !== false;
    const foreignKeysBefore = this._db().pragma('foreign_keys', { simple: true });

    try {
      if (ignoreForeignKeys && foreignKeysBefore) this._db().pragma('foreign_keys = OFF');
      await this._execute(`DELETE FROM ${this._q(tableName)}`);
      await this._execute('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
    } finally {
      if (ignoreForeignKeys && foreignKeysBefore) this._db().pragma('foreign_keys = ON');
    }
  }

  async hasTable(tableName) {
    const row = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return !!row;
  }

  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    const rows = this._db().prepare(`PRAGMA table_info(${this._q(tableName)})`).all();
    return { tableName, columns: rows.map(row => ({ name: row.name, type: row.type, allowNull: !row.notnull, primaryKey: !!row.pk, defaultValue: row.dflt_value })) };
  }

  introspectDefinition(definition) {
    const def = this.normalizeDefinition(definition);
    const tableInfo = this._db().prepare(`PRAGMA table_info(${this._q(def.tableName)})`).all();
    const physicalColumns = new Set(tableInfo.map(row => row.name));
    const columns = {};
    const attrToColumn = {};
    const columnToAttr = {};
    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const columnName = colDef.field || def.attrToColumn[attrName] || attrName;
      if (!physicalColumns.has(columnName)) continue;
      columns[attrName] = colDef;
      attrToColumn[attrName] = columnName;
      columnToAttr[columnName] = attrName;
    }

    const indexRows = this._db().prepare(`PRAGMA index_list(${this._q(def.tableName)})`).all();
    const existingIndexNames = new Set(indexRows.map(row => row.name));
    const uniqueConstraints = def.uniqueConstraints.filter(item => existingIndexNames.has(item.constraintName));
    const indexes = def.indexes.filter(item => existingIndexNames.has(item.name));

    const physicalFKs = this._db().prepare(`PRAGMA foreign_key_list(${this._q(def.tableName)})`).all();
    const foreignKeys = def.foreignKeys.filter(fk => physicalFKs.some(row =>
      row.from === fk.columnName && row.table === fk.references.table && row.to === fk.references.column
    ));

    return { ...def, columns, attrToColumn, columnToAttr, uniqueConstraints, indexes, foreignKeys };
  }

  async listTables() {
    const rows = this._db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    return rows.map(r => r.name);
  }

  async addForeignKey(tableName, fk) {
    if (this._adapter.fkStrategy === 'alter') return super.addForeignKey(tableName, fk);
    const schema = this._adapter.schemas.get(tableName);
    if (schema?.foreignKeys.some(existing => existing.constraintName === fk.constraintName)) return;
    throw new AdapterError('SQLite cannot add a foreign key to an existing table without rebuilding it', {
      code: 'SEQ_DDL_FOREIGN_KEY_ALTER_NOT_SUPPORTED',
      details: { tableName, constraintName: fk.constraintName }
    });
  }

  _literal(value) {
    if (value === null) return 'NULL';
    if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    }
    throw new AdapterError('Unsupported SQLite default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }

  _formatDefaultValue(value) {
    return this._literal(value);
  }
}
