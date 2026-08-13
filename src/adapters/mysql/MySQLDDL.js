import { DDLAbstract } from '../abstract/DDLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { MySQLError } from './MySQLError.js';

export class MySQLDDL extends DDLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _connection() {
    return this._adapter._connection();
  }

  async _execute(sql, params = []) {
    this._log('trace', sql.replaceAll('\n  ', ' '), params);
    try {
      const [result] = await this._connection().execute(sql, params);
      return result;
    } catch (error) {
      throw MySQLError.from(error);
    }
  }

  async createTableStructure(def) {
    const colDefs = [];
    const primaryKeys = [];

    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const colName = colDef.field || attrName;
      const parts = [this._q(colName), this._adapter.mapDataType(colDef.type)];
      if (!colDef.allowNull && !colDef.primaryKey) parts.push('NOT NULL');
      if (colDef.autoIncrement) parts.push('AUTO_INCREMENT');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null && typeof colDef.defaultValue !== 'function') {
        parts.push(`DEFAULT ${this._formatDefaultValue(colDef.defaultValue)}`);
      }
      colDefs.push(parts.join(' '));
      if (colDef.primaryKey) primaryKeys.push(colName);
    }

    if (primaryKeys.length > 0) {
      colDefs.push(`PRIMARY KEY (${primaryKeys.map(col => this._q(col)).join(', ')})`);
    }

    const sql = `CREATE TABLE ${this._q(def.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
    await this._execute(sql);
  }

  async dropTable(tableName, options = {}) {
    if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await this._execute(`DROP TABLE IF EXISTS ${this._q(tableName)}`);
    } finally {
      if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 1');
    }
    await super.dropTable(tableName, options);
  }

  async truncateTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;
    if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`);
    } finally {
      if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 1');
    }
  }

  async hasTable(tableName) {
    const row = await this._executeGet(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
      [tableName]
    );
    return !!row;
  }

  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    const rows = await this._executeQueryAll(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return {
      tableName,
      columns: rows.map(row => ({
        name: row.COLUMN_NAME,
        type: row.COLUMN_TYPE,
        allowNull: row.IS_NULLABLE === 'YES',
        primaryKey: row.COLUMN_KEY === 'PRI',
        autoIncrement: String(row.EXTRA || '').includes('auto_increment'),
        defaultValue: row.COLUMN_DEFAULT
      }))
    };
  }

  async introspectDefinition(definition) {
    const def = this.normalizeDefinition(definition);
    const columnsInfo = await this._executeQueryAll(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [def.tableName]
    );
    const physicalColumns = new Set(columnsInfo.map(row => row.COLUMN_NAME));
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

    const indexRows = await this._executeQueryAll(
      `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [def.tableName]
    );
    const existingIndexNames = new Set(indexRows.map(row => row.INDEX_NAME));
    const uniqueConstraints = def.uniqueConstraints.filter(item => existingIndexNames.has(item.constraintName));
    const indexes = def.indexes.filter(item => existingIndexNames.has(item.name));

    const fkRows = await this._executeQueryAll(
      `SELECT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [def.tableName]
    );
    const existingFKNames = new Set(fkRows.map(row => row.CONSTRAINT_NAME));
    const foreignKeys = def.foreignKeys.filter(fk => existingFKNames.has(fk.constraintName));

    return { ...def, columns, attrToColumn, columnToAttr, uniqueConstraints, indexes, foreignKeys };
  }

  async listTables() {
    const rows = await this._executeQueryAll(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?',
      ['BASE TABLE']
    );
    return rows.map(row => row.TABLE_NAME);
  }

  async addColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      const colType = this._adapter.mapDataType(colDef.type);
      const columnName = colDef.field || name;
      const constraints = [];
      if (!colDef.allowNull && colDef.defaultValue === undefined) {
        throw new AdapterError(`Cannot add required column "${name}" without a default value`, {
          code: 'SEQ_DDL_REQUIRED_COLUMN_NEEDS_DEFAULT',
          details: { tableName, field: name }
        });
      }
      if (!colDef.allowNull) constraints.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null) {
        const value = typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue;
        constraints.push(`DEFAULT ${this._formatDefaultValue(value)}`);
      }
      await this._execute(`ALTER TABLE ${this._q(tableName)} ADD COLUMN ${this._q(columnName)} ${colType}${constraints.length ? ` ${constraints.join(' ')}` : ''}`);
      schema.columns[name] = colDef;
      schema.attrToColumn[name] = columnName;
      schema.columnToAttr[columnName] = name;
    }
  }

  async addUniqueConstraint(tableName, constraint) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = constraint.columns.map(c => this._q(c)).join(', ');
    await this._execute(`CREATE UNIQUE INDEX ${this._q(constraint.constraintName)} ON ${this._q(tableName)} (${cols})`);
    schema.uniqueConstraints.push({ ...constraint });
  }

  async addIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = index.columns.map(c => this._q(c)).join(', ');
    const unique = index.unique ? 'UNIQUE ' : '';
    await this._execute(`CREATE ${unique}INDEX ${this._q(index.name)} ON ${this._q(tableName)} (${cols})`);
    schema.indexes.push({ ...index });
  }

  async addForeignKey(tableName, fk) {
    const sql = `ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(fk.constraintName)} FOREIGN KEY (${this._q(fk.columnName)}) REFERENCES ${this._q(fk.references.table)} (${this._q(fk.references.column)}) ON DELETE ${fk.onDelete || 'RESTRICT'} ON UPDATE ${fk.onUpdate || 'RESTRICT'}`;
    await this._execute(sql);
    const schema = this._adapter.schemas.get(tableName);
    schema.foreignKeys.push({ ...fk });
  }

  async _executeQueryAll(sql, params = []) {
    this._log('trace', sql, params);
    const [rows] = await this._connection().execute(sql, params);
    return rows;
  }

  async _executeGet(sql, params = []) {
    const rows = await this._executeQueryAll(sql, params);
    return rows[0] || null;
  }

  _formatDefaultValue(value) {
    if (value === null) return 'NULL';
    if (value instanceof Date) return `'${this._formatDate(value)}'`;
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    }
    throw new AdapterError('Unsupported MySQL default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }

  _formatDate(date) {
    return date.toISOString().slice(0, 23).replace('T', ' ');
  }
}
