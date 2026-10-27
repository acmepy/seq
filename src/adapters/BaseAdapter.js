import { applyConvention, applyCase, initCap, truncateMiddle } from '../utils/naming.js';
import { primaryAttributes } from '../utils/keys.js';
import { ModelError } from '../core/errors/ModelError.js';
import { modelTenant } from '../core/TenantResolver.js';
/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
export class BaseAdapter {
  static defaultNaming = {
    tables: undefined,
    columns: undefined,
    prefix: undefined,
    caseStyle: undefined,
    maxLength: 50
  };

  /**
   * @param {object} [options]
   * @param {object} [options.naming]
   * @param {'alter'|'inline'|'none'} [options.fkStrategy]
   * @param {boolean} [options.eager]
   */
  constructor(options = {}) {
    const defaultNaming = this.constructor.defaultNaming || BaseAdapter.defaultNaming;
    this._naming = { ...BaseAdapter.defaultNaming, ...defaultNaming, ...(options.naming || {}) };
    this.options = { ...options, naming: this._naming };
    this._fkStrategy = options.fkStrategy !== undefined ? options.fkStrategy : 'alter';
    this._eager = options.eager !== undefined ? options.eager : false;
    this.schemas = new Map();
    this.ddl = null;
    this.dml = null;
    this.dcl = null;
    this.tcl = null;
    this._activeTransaction = null;
  }

  /**
   * Connects to the data source (no-op for in-memory adapters).
   */
  async connect() {}

  /**
   * Validates that the data source is reachable.
   * Adapters with a real connection should override this with a lightweight query.
   * @returns {Promise<boolean>}
   */
  async authenticate() {
    await this.connect();
    return true;
  }

  /**
   * Validates optional runtime dependencies required by the adapter.
   * Adapters with external drivers should override this method.
   * @returns {Promise<boolean>}
   */
  async validateDependencies() {
    return true;
  }

  /**
   * Closes the connection (no-op for in-memory adapters).
   */
  async close() {}

  /**
   * Initializes the adapter.
   */
  async initialize() {}

  /**
   * Inspects the virtual database and returns metadata.
   * @returns {Promise<object>}
   */
  async inspectDatabase() {
    return { tables: [] };
  }

  /**
   * Maps an abstract DataType to a native type string.
   * @param {import('../data-types/AbstractDataType.js').AbstractDataType} dataType
   * @returns {string}
   */
  mapDataType(dataType) {
    return dataType.toString();
  }

  /**
   * Quotes a SQL identifier (table, column, index, constraint name).
   * Default uses double quotes (standard SQL). Override for adapter-specific quoting.
   * MySQL: `\`${name}\``, SQL Server: `[${name}]`
   * @param {string} name - The identifier to quote
   * @returns {string}
   */
  _quoteIdentifier(name) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) {
      throw new TypeError('SQL identifiers must be non-empty strings without null bytes');
    }
    return `"${name.replaceAll('"', '""')}"`;
  }

  /**
   * Returns the FK creation strategy for this adapter.
   * - 'alter': FKs created via ALTER TABLE ADD CONSTRAINT (default for most DBs)
   * - 'inline': FKs included in CREATE TABLE statement (SQLite)
   * - 'none': no physical FK creation (in-memory adapters)
   * @returns {string} 'alter' | 'inline' | 'none'
   */
  get fkStrategy() {
    return this._fkStrategy;
  }

  /**
   * Returns the default include loading strategy for this adapter.
   * Query-level `eager` and include-level `eager` can override this value.
   * @returns {boolean}
   */
  get eager() {
    return this._eager;
  }

  /**
   * Returns the naming policy for physical table and column names.
   * @returns {object}
   */
  get naming() {
    return this._naming;
  }

  resolveTableName(modelClass) {
    const name = (modelClass.tableName? modelClass.tableName : this.naming.prefix ? `${this.naming.prefix}${initCap(modelClass.modelName)}` : modelClass.modelName).replace(/[^A-Za-z0-9_$#]+/g, '_');
    const convention = modelClass.tableName ? null : this.naming.tables;
    return truncateMiddle(applyCase(applyConvention(name, convention), this._caseStyle(convention)), this.naming.maxLength);
  }

  resolveColumnName(def, attrName) {
    const name = def.field || (this.naming.columns ? initCap(attrName) : attrName);
    const convention = def.field ? null : this.naming.columns;
    return (truncateMiddle(applyCase(applyConvention(name, convention), this._caseStyle(convention)), this.naming.maxLength)).replace(/[^A-Za-z0-9_$#]+/g, '_');
  }

  _caseStyle(convention) {
    return convention === 'snake_case' ? this.naming.caseStyle : null;
  }

  uniqueConstraintName(tableName, columns) {
    return truncateMiddle(applyCase(`uk_${tableName.replaceAll(this.naming.prefix, '')}_${columns.join('_')}`, this.naming.caseStyle), this.naming.maxLength);
  }

  foreignKeyConstraintName(sourceTable, refTable, fkColumn) {
    return truncateMiddle(applyCase(`fk_${this._constraintTableName(sourceTable).replaceAll(this.naming.prefix, '')}_${fkColumn}`, this.naming.caseStyle), this.naming.maxLength);
  }

  junctionUniqueConstraintName(throughTable, fkColumn, otherKeyColumn) {
    return truncateMiddle(applyCase(`uk_${throughTable.replaceAll(this.naming.prefix, '')}_${fkColumn}_${otherKeyColumn}`, this.naming.caseStyle), this.naming.maxLength);
  }

  junctionForeignKeyConstraintName(throughTable, columnName) {
    return truncateMiddle(applyCase(`fk_${throughTable.replaceAll(this.naming.prefix, '')}_${columnName}`, this.naming.caseStyle), this.naming.maxLength);
  }

  buildTableDefinition(modelClass, context) {
    const attributes = modelClass.rawAttributes || {};
    const columns = {};
    const uniqueConstraints = [];
    const attrToColumn = {};
    const columnToAttr = {};
    const virtualAttributes = [];
    const sourceTable = modelClass._resolvedTableName || this.resolveTableName(modelClass);

    for (const [name, def] of Object.entries(attributes)) {
      if (modelClass._isVirtualAttribute?.(def)) {
        virtualAttributes.push(name);
        continue;
      }
      const columnName = this.resolveColumnName(def, name);
      attrToColumn[name] = columnName;
      columnToAttr[columnName] = name;

      columns[name] = {
        type: def.type,
        primaryKey: def.primaryKey || false,
        autoIncrement: def.autoIncrement || false,
        allowNull: def.primaryKey ? false : (def.allowNull !== undefined ? def.allowNull : true),
        defaultValue: def.defaultValue,
        defaultCurrentTimestamp: def.defaultCurrentTimestamp === true,
        validate: def.validate,
        field: columnName
      };

      if (def.unique) uniqueConstraints.push({ columns: [columnName], constraintName: this.uniqueConstraintName(sourceTable, [columnName]) });
    }

    const pkAttr = modelClass.primaryKeyAttribute;
    const aiAttr = modelClass.autoIncrementAttribute;
    const foreignKeys = this.buildForeignKeys(modelClass, attrToColumn, context);
    const indexes = (modelClass.options?.indexes || []).map(index => ({
      name: index.name,
      columns: (index.columns || []).map(column => attrToColumn[column] || column),
      unique: index.unique || false
    }));

    return {
      modelName: modelClass.modelName,
      tableName: sourceTable,
      columns,
      uniqueConstraints,
      indexes,
      foreignKeys,
      primaryKey: pkAttr ? attrToColumn[pkAttr] : null,
      autoIncrement: aiAttr ? attrToColumn[aiAttr] : null,
      primaryKeyAttribute: pkAttr || null,
      primaryKeyAttributes: [...primaryAttributes(modelClass)],
      primaryKeys: primaryAttributes(modelClass).map(attr => attrToColumn[attr]),
      autoIncrementAttribute: aiAttr || null,
      timestamps: modelClass.options?.timestamps || false,
      createdAt: modelClass.options?.createdAt || 'createdAt',
      updatedAt: modelClass.options?.updatedAt || 'updatedAt',
      virtualAttributes,
      attrToColumn,
      columnToAttr
    };
  }

  buildJunctionTableDefinition(assoc, context) {
    const source = assoc.source;
    const target = assoc.target;
    const through = this.getAssociationThroughTable(assoc);
    const fkAttr = assoc.foreignKey;
    const otherKeyAttr = assoc.otherKey;

    const sourcePKAttr = source.primaryKeyAttribute || 'id';
    const sourcePKDef = source.rawAttributes[sourcePKAttr] || {};
    const sourcePKType = sourcePKDef.type;
    const sourcePKCol = this.resolveColumnName(sourcePKDef, sourcePKAttr);

    const targetPKAttr = target.primaryKeyAttribute || 'id';
    const targetPKDef = target.rawAttributes[targetPKAttr] || {};
    const targetPKType = targetPKDef.type;
    const targetPKCol = this.resolveColumnName(targetPKDef, targetPKAttr);

    const sourceTable = source._resolvedTableName || this.resolveTableName(source);
    const targetTable = target._resolvedTableName || this.resolveTableName(target);

    const fkCol = fkAttr;
    const otherKeyCol = otherKeyAttr;

    const columns = {
      [fkAttr]: {type: sourcePKType, primaryKey: false, autoIncrement: false, allowNull: false, field: fkCol},
      [otherKeyAttr]: {type: targetPKType, primaryKey: false, autoIncrement: false, allowNull: false, field: otherKeyCol}
    };

    const uniqueConstraints = [{ columns: [fkCol, otherKeyCol], constraintName: this.junctionUniqueConstraintName(through, fkCol, otherKeyCol) }];
    const owner = modelTenant(source) ? source : modelTenant(target) ? target : null;
    const tenantAttribute = owner ? modelTenant(owner).attribute : null;
    const tenantColumn = owner ? this.resolveColumnName(owner.rawAttributes[tenantAttribute], tenantAttribute) : null;
    if (owner) {
      columns[tenantAttribute] = { type: owner.rawAttributes[tenantAttribute].type, field: tenantColumn, allowNull: false };
      uniqueConstraints[0].columns.unshift(tenantColumn);
    }
    const foreignKeys = [
      {
        attributeName: fkAttr,
        columnName: fkCol,
        constraintName: this.junctionForeignKeyConstraintName(through, fkCol),
        references: { model: source.modelName, table: sourceTable, key: sourcePKAttr, column: sourcePKCol },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      {
        attributeName: otherKeyAttr,
        columnName: otherKeyCol,
        constraintName: this.junctionForeignKeyConstraintName(through, otherKeyCol),
        references: { model: target.modelName, table: targetTable, key: targetPKAttr, column: targetPKCol },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      }
    ];

    return {
      modelName: null,
      tableName: through,
      tenantAttribute,
      columns,
      uniqueConstraints,
      indexes: [],
      foreignKeys,
      primaryKey: null,
      autoIncrement: null,
      primaryKeyAttribute: null,
      autoIncrementAttribute: null,
      timestamps: false,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      attrToColumn: { [fkAttr]: fkCol, [otherKeyAttr]: otherKeyCol, ...(owner ? { [tenantAttribute]: tenantColumn } : {}) },
      columnToAttr: { [fkCol]: fkAttr, [otherKeyCol]: otherKeyAttr, ...(owner ? { [tenantColumn]: tenantAttribute } : {}) }
    };
  }

  buildJunctionTables(models) {
    const junctions = [];
    const seen = new Set();
    for (const modelClass of models) {
      for (const assoc of Object.values(modelClass.associations || {})) {
        if (assoc.type !== 'belongsToMany') continue;
        if (assoc.throughModel) continue;
        const through = this.getAssociationThroughTable(assoc);
        if (seen.has(through)) continue;
        seen.add(through);
        junctions.push(assoc);
      }
    }
    return junctions;
  }

  getAssociationThroughTable(assoc) {
    return assoc.throughModel?._resolvedTableName
      || assoc.throughModel?.tableName
      || assoc.throughTable
      || assoc.through;
  }

  buildForeignKeys(modelClass, attrToColumn, context) {
    const fkMap = new Map();
    const sourceTable = modelClass._resolvedTableName || this.resolveTableName(modelClass);
    const add = (attrs, parent, keys, options) => {
      const columnNames = attrs.map(attr => attrToColumn[attr] || attr);
      const refTable = parent._resolvedTableName || this.resolveTableName(parent);
      const refColumns = keys.map(key => this.resolveColumnName(parent.rawAttributes[key] || {}, key));
      const entry = {
        attributeNames: attrs, columnNames,
        attributeName: attrs.length === 1 ? attrs[0] : null,
        columnName: columnNames.length === 1 ? columnNames[0] : null,
        constraintName: options.constraintName || this.foreignKeyConstraintName(sourceTable, refTable, columnNames.join('_')),
        references: { model: parent.modelName, table: refTable, keys, columns: refColumns,
          key: keys.length === 1 ? keys[0] : null, column: refColumns.length === 1 ? refColumns[0] : null },
        onDelete: options.onDelete || 'RESTRICT', onUpdate: options.onUpdate || 'RESTRICT'
      };
      const identity = JSON.stringify([columnNames, refTable, refColumns]);
      const existing = fkMap.get(identity);
      if (!existing) fkMap.set(identity, entry);
      else {
        if (options.onDelete && options.onDelete !== 'RESTRICT') existing.onDelete = options.onDelete;
        if (options.onUpdate && options.onUpdate !== 'RESTRICT') existing.onUpdate = options.onUpdate;
        if (options.constraintName) existing.constraintName = options.constraintName;
      }
    };
    for (const [attr, def] of Object.entries(modelClass.rawAttributes || {})) {
      if (modelClass._isVirtualAttribute?.(def) || !def.references) continue;
      const parent = context.getModel(def.references.model);
      if (!parent) continue;
      if (!def.references.key && primaryAttributes(parent).length > 1) {
        throw new ModelError('Composite references must be defined with an association and foreignKey attributes', { code: 'SEQ_ASSOCIATION_INVALID_FOREIGN_KEY' });
      }
      add([attr], parent, [def.references.key || parent.primaryKeyAttribute || 'id'], { ...def, constraintName: def.references.constraintName });
    }
    for (const assoc of Object.values(modelClass.associations || {})) {
      if (assoc.type === 'belongsTo') add(assoc.foreignKeys, assoc.target, assoc.referencedKeys, assoc);
    }
    for (const other of context.models) {
      for (const assoc of Object.values(other.associations || {})) {
        if ((assoc.type === 'hasMany' || assoc.type === 'hasOne') && assoc.target === modelClass) {
          add(assoc.foreignKeys, assoc.source, assoc.referencedKeys, assoc);
        }
      }
    }
    return [...fkMap.values()];
  }

  _constraintTableName(tableName) {
    const prefix = this.naming?.prefix;
    if (!prefix) return String(tableName);

    const token = String(prefix).endsWith('_') ? String(prefix) : `${prefix}_`;
    return String(tableName).replaceAll(token, '');
  }

  /**
   * Normalizes a value for storage.
   * @param {import('../../types/index.d.ts').AttributeDefinition} attribute - The attribute definition
   * @param {*} value - The value to normalize
   * @returns {*}
   */
  normalizeValue(attribute, value) {
    return value;
  }

  /**
   * Logs through the owning Seq instance when logging is enabled.
   */
  _log(...args) {
    this._seq?._log(...args);
  }

  _measureSql(sql, params = [], execute) {
    const loggedSql = sql.replace(/\s+/g, ' ').trim();
    const startedAt = performance.now();
    const finish = (level, error) => {
      const sqlDurationMs = performance.now() - startedAt;
      this._log(level, loggedSql, params, {
        type: 'sql',
        sqlDurationMs,
        error: error ? { name: error.name, message: error.message, code: error.code, stack: error.stack } : undefined
      });
    };
    const success = result => {
      finish(this._seq?._isSlowQuery(performance.now() - startedAt) ? 'warn' : 'trace');
      return result;
    };
    const failure = error => {
      finish('error', error);
      throw error;
    };

    try {
      const result = execute();
      return result && typeof result.then === 'function' ? result.then(success, failure) : success(result);
    } catch (error) {
      return failure(error);
    }
  }
}
