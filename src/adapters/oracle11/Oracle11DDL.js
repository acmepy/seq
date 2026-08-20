import { DDLAbstract } from '../abstract/DDLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { Oracle11Error } from './Oracle11Error.js';

export class Oracle11DDL extends DDLAbstract {
  _connection() { return this._adapter._connection(); }
  _oracleSql(sql) { let index = 0; return sql.replaceAll('?', () => `:${++index}`); }
  async _execute(sql, params = []) {
    try { return await this._adapter._withConnection(connection => connection.execute(this._oracleSql(sql), params, { autoCommit: !this._adapter._activeTransaction })); }
    catch (error) { throw Oracle11Error.from(error); }
  }
  async _executeQueryAll(sql, params = []) { return this._adapter._withConnection(async connection => (await connection.execute(this._oracleSql(sql), params, { outFormat: this._adapter._client.OUT_FORMAT_OBJECT })).rows || []); }
  async _executeGet(sql, params = []) { return (await this._executeQueryAll(sql, params))[0] || null; }
  _usesSequenceForAutoIncrement() { return true; }

  async createTableStructure(def) {
    const columns = []; const primaryKeys = [];
    for (const [attr, column] of Object.entries(def.columns)) {
      const name = column.field || attr;
      const parts = [this._q(name), this._adapter.mapDataType(column.type)];
      if (!column.allowNull && !column.primaryKey) parts.push('NOT NULL');
      if (column.defaultValue !== undefined && column.defaultValue !== null && typeof column.defaultValue !== 'function') parts.push(`DEFAULT ${this._formatDefaultValue(column.defaultValue)}`);
      columns.push(parts.join(' ')); if (column.primaryKey) primaryKeys.push(name);
    }
    if (primaryKeys.length) columns.push(`PRIMARY KEY (${primaryKeys.map(key => this._q(key)).join(', ')})`);
    await this._execute(`CREATE TABLE ${this._q(def.tableName)} (\n  ${columns.join(',\n  ')}\n)`);
    if (def.autoIncrement && this._usesSequenceForAutoIncrement()) await this._execute(`CREATE SEQUENCE ${this._q(this._adapter.sequenceName(def.tableName))} START WITH 1 INCREMENT BY 1`);
  }

  async dropTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;
    await this._execute(`DROP TABLE ${this._q(tableName)}${options.ignoreForeignKeys !== false ? ' CASCADE CONSTRAINTS' : ''}`);
    try { await this._execute(`DROP SEQUENCE ${this._q(this._adapter.sequenceName(tableName))}`); } catch (error) { if (!/ORA-02289/.test(error?.message || '')) throw error; }
    await super.dropTable(tableName, options);
  }
  async truncateTable(tableName, options = {}) { if (!options.ifExists || await this.hasTable(tableName)) await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`); }
  async hasTable(tableName) { return !!await this._executeGet('SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME = ?', [tableName]); }
  async listTables() { return (await this._executeQueryAll('SELECT TABLE_NAME FROM USER_TABLES')).map(row => row.TABLE_NAME); }
  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    const rows = await this._executeQueryAll('SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE, DATA_DEFAULT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = ? ORDER BY COLUMN_ID', [tableName]);
    const primaryKeys = new Set((await this._executeQueryAll('SELECT COLUMN_NAME FROM USER_CONS_COLUMNS WHERE TABLE_NAME = ? AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = \'P\')', [tableName, tableName])).map(row => row.COLUMN_NAME));
    return { tableName, columns: rows.map(row => ({ name: row.COLUMN_NAME, type: row.DATA_TYPE, allowNull: row.NULLABLE === 'Y', primaryKey: primaryKeys.has(row.COLUMN_NAME), autoIncrement: false, defaultValue: row.DATA_DEFAULT })) };
  }
  async addColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [attr, column] of Object.entries(missingColumns)) {
      const name = column.field || attr; const parts = [this._q(name), this._adapter.mapDataType(column.type)];
      if (!column.allowNull) parts.push('NOT NULL'); if (column.defaultValue !== undefined && column.defaultValue !== null) parts.push(`DEFAULT ${this._formatDefaultValue(column.defaultValue)}`);
      await this._execute(`ALTER TABLE ${this._q(tableName)} ADD (${parts.join(' ')})`);
      schema.columns[attr] = column; schema.attrToColumn[attr] = name; schema.columnToAttr[name] = attr;
    }
  }
  async addUniqueConstraint(tableName, constraint) { await this._execute(`ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(constraint.constraintName)} UNIQUE (${constraint.columns.map(column => this._q(column)).join(', ')})`); this._adapter.schemas.get(tableName).uniqueConstraints.push({ ...constraint }); }
  async addIndex(tableName, index) { await this._execute(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${this._q(index.name)} ON ${this._q(tableName)} (${index.columns.map(column => this._q(column)).join(', ')})`); this._adapter.schemas.get(tableName).indexes.push({ ...index }); }
  async addForeignKey(tableName, fk) {
    const deleteClause = fk.onDelete === 'CASCADE' || fk.onDelete === 'SET NULL' ? ` ON DELETE ${fk.onDelete}` : '';
    await this._execute(`ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(fk.constraintName)} FOREIGN KEY (${this._q(fk.columnName)}) REFERENCES ${this._q(fk.references.table)} (${this._q(fk.references.column)})${deleteClause}`);
    this._adapter.schemas.get(tableName).foreignKeys.push({ ...fk });
  }
  _formatDefaultValue(value) { if (value === null) return 'NULL'; if (value instanceof Date) return `TO_DATE('${value.toISOString().slice(0, 19).replace('T', ' ')}', 'YYYY-MM-DD HH24:MI:SS')`; if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`; if (typeof value === 'boolean') return value ? '1' : '0'; if (typeof value === 'number' && Number.isFinite(value)) return String(value); if (Array.isArray(value) || typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`; throw new AdapterError('Unsupported Oracle default value', { code: 'SEQ_DDL_INVALID_DEFAULT' }); }
}
