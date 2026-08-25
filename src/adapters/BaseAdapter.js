import { applyConvention, applyCase, initCap, truncateMiddle } from '../utils/naming.js';
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
    return truncateMiddle(applyCase(`fk_${this._constraintTableName(sourceTable).replaceAll(this.naming.prefix, '')}_${this._constraintTableName(refTable)}_${fkColumn}`, this.naming.caseStyle), this.naming.maxLength);
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
        allowNull: def.allowNull !== undefined ? def.allowNull : true,
        defaultValue: def.defaultValue,
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
      attrToColumn: { [fkAttr]: fkCol, [otherKeyAttr]: otherKeyCol },
      columnToAttr: { [fkCol]: fkAttr, [otherKeyCol]: otherKeyAttr }
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
    const upsertFK = (fkCol, entry) => {
      const existing = fkMap.get(fkCol);
      if (!existing) {
        fkMap.set(fkCol, entry);
      } else {
        if (entry.onDelete && entry.onDelete !== 'RESTRICT') existing.onDelete = entry.onDelete;
        if (entry.onUpdate && entry.onUpdate !== 'RESTRICT') existing.onUpdate = entry.onUpdate;
        if (entry.constraintName) existing.constraintName = entry.constraintName;
      }
    };

    for (const [attrName, def] of Object.entries(modelClass.rawAttributes || {})) {
      if (modelClass._isVirtualAttribute?.(def)) continue;
      if (def.references) {
        const refModel = context.getModel(def.references.model);
        if (!refModel) continue;
        const refPkAttr = def.references.key || refModel.primaryKeyAttribute || 'id';
        const refTable = refModel._resolvedTableName || this.resolveTableName(refModel);
        const refPkCol = this.resolveColumnName(refModel.rawAttributes[refPkAttr] || {}, refPkAttr);
        const fkCol = attrToColumn[attrName] || attrName;
        const constraintName = def.references.constraintName || this.foreignKeyConstraintName(sourceTable, refTable, fkCol);
        upsertFK(fkCol, {
          attributeName: attrName,
          columnName: fkCol,
          constraintName,
          references: { model: def.references.model, table: refTable, key: refPkAttr, column: refPkCol },
          onDelete: def.onDelete || 'RESTRICT',
          onUpdate: def.onUpdate || 'RESTRICT'
        });
      }
    }

    for (const assoc of Object.values(modelClass.associations || {})) {
      if (assoc.type !== 'belongsTo') continue;
      const fkAttr = assoc.foreignKey;
      const refPkAttr = assoc.target.primaryKeyAttribute || 'id';
      const refTable = assoc.target._resolvedTableName || this.resolveTableName(assoc.target);
      const refPkCol = this.resolveColumnName(assoc.target.rawAttributes[refPkAttr] || {}, refPkAttr);
      const fkCol = attrToColumn[fkAttr] || fkAttr;
      const constraintName = assoc.constraintName || this.foreignKeyConstraintName(sourceTable, refTable, fkCol);
      upsertFK(fkCol, {
        attributeName: fkAttr,
        columnName: fkCol,
        constraintName,
        references: { model: assoc.target.modelName, table: refTable, key: refPkAttr, column: refPkCol },
        onDelete: assoc.onDelete,
        onUpdate: assoc.onUpdate
      });
    }

    for (const otherModel of context.models) {
      if (otherModel === modelClass) continue;
      for (const assoc of Object.values(otherModel.associations || {})) {
        if (assoc.type !== 'hasMany' && assoc.type !== 'hasOne') continue;
        if (assoc.target !== modelClass) continue;
        const fkAttr = assoc.foreignKey;
        if (!modelClass.rawAttributes || !modelClass.rawAttributes[fkAttr]) continue;
        const refPkAttr = assoc.source.primaryKeyAttribute || 'id';
        const refTable = assoc.source._resolvedTableName || this.resolveTableName(assoc.source);
        const refPkCol = this.resolveColumnName(assoc.source.rawAttributes[refPkAttr] || {}, refPkAttr);
        const fkCol = attrToColumn[fkAttr] || fkAttr;
        const constraintName = assoc.constraintName || this.foreignKeyConstraintName(sourceTable, refTable, fkCol);
        upsertFK(fkCol, {
          attributeName: fkAttr,
          columnName: fkCol,
          constraintName,
          references: { model: assoc.source.modelName, table: refTable, key: refPkAttr, column: refPkCol },
          onDelete: assoc.onDelete,
          onUpdate: assoc.onUpdate
        });
      }
    }
    return Array.from(fkMap.values());
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
        error: error ? { name: error.name, message: error.message, code: error.code } : undefined
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
