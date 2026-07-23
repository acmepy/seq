import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { Op } from '../../operators.js';
import { resolveWhereValue } from '../../utils/where.js';
import { loadIncludes, processJoinedRows, resolveIncludeAlias, resolveEager, resolveAssociation } from '../../utils/include.js';

/**
 * Base DML abstract.
 * Provides SQL-based default implementations for selectAll, count, update, delete.
 * Adapter subclasses implement execution hooks (_executeQuery, _executeGet, _execute, _mapRows)
 * and adapter-specific methods (insert, truncate).
 */
export class DMLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Returns the effective table name for a model.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {string}
   */
  _getTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  /**
   * Returns the table name, schema, and alias for a model.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {{ tableName: string, schema: object, alias: string|null }}
   */
  _schema(model) {
    const tableName = this._getTableName(model);
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    return { tableName, schema, alias: model.alias || null };
  }

  _associationThroughTable(assoc) {
    return assoc.throughModel?._resolvedTableName
      || assoc.throughModel?.tableName
      || assoc.throughTable
      || assoc.through;
  }

  /**
   * Generates a column reference, optionally prefixed with a table alias.
   * @param {string} colName
   * @param {string|null} alias
   * @returns {string}
   */
  _q(name) {
    return this._adapter._quoteIdentifier(name);
  }

  _colRef(colName, alias) {
    return alias ? `${this._q(alias)}.${this._q(colName)}` : this._q(colName);
  }

  /**
   * Applies default values to a column-name record.
   * @param {object} colRecord
   * @param {object} schema
   */
  _applyDefaults(colRecord, schema) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      if (!(colName in colRecord) || colRecord[colName] === undefined || colRecord[colName] === null) {
        if (colDef.defaultValue !== undefined) {
          colRecord[colName] = typeof colDef.defaultValue === 'function'
            ? colDef.defaultValue()
            : colDef.defaultValue;
        }
      }
    }
  }

  /**
   * Applies timestamp columns (createdAt, updatedAt) to a column-name record.
   * @param {object} colRecord
   * @param {object} schema
   */
  _applyTimestamps(colRecord, schema) {
    if (schema.timestamps) {
      const now = new Date();
      const createdCol = schema.attrToColumn[schema.createdAt] || schema.createdAt;
      const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
      if (!colRecord[createdCol]) colRecord[createdCol] = now;
      if (!colRecord[updatedCol]) colRecord[updatedCol] = now;
    }
  }

  /**
   * Serializes a value for SQL parameter binding.
   * Default is pass-through. Override in adapter for type-specific serialization.
   * @param {*} v
   * @returns {*}
   */
  _serializeValue(v) {
    return v;
  }

  _buildCondition(col, rawValue) {
    if (rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)
      && Object.getOwnPropertySymbols(rawValue).length > 1) {
      throw new ValidationError('A field condition can contain only one operator', { code: 'SEQ_VALIDATION_OPERATOR' });
    }
    const { op, value } = resolveWhereValue(rawValue);
    switch (op) {
      case Op.eq:
        if (value === null) return { sql: `${col} IS NULL`, params: [] };
        return { sql: `${col} = ?`, params: [this._serializeValue(value)] };
      case Op.ne:
        if (value === null) return { sql: `${col} IS NOT NULL`, params: [] };
        return { sql: `${col} != ?`, params: [this._serializeValue(value)] };
      case Op.gt:
        return { sql: `${col} > ?`, params: [this._serializeValue(value)] };
      case Op.gte:
        return { sql: `${col} >= ?`, params: [this._serializeValue(value)] };
      case Op.lt:
        return { sql: `${col} < ?`, params: [this._serializeValue(value)] };
      case Op.lte:
        return { sql: `${col} <= ?`, params: [this._serializeValue(value)] };
      case Op.like:
        return { sql: `${col} LIKE ?`, params: [this._serializeValue(value)] };
      case Op.notLike:
        return { sql: `${col} NOT LIKE ?`, params: [this._serializeValue(value)] };
      case Op.in: {
        if (!Array.isArray(value)) throw new ValidationError('Op.in requires an array', { code: 'SEQ_VALIDATION_OPERATOR' });
        if (value.length === 0) return { sql: '0 = 1', params: [] };
        const inParams = value.map(v => this._serializeValue(v));
        return { sql: `${col} IN (${inParams.map(() => '?').join(', ')})`, params: inParams };
      }
      case Op.notIn: {
        if (!Array.isArray(value)) throw new ValidationError('Op.notIn requires an array', { code: 'SEQ_VALIDATION_OPERATOR' });
        if (value.length === 0) return { sql: '1 = 1', params: [] };
        const notInParams = value.map(v => this._serializeValue(v));
        return { sql: `${col} NOT IN (${notInParams.map(() => '?').join(', ')})`, params: notInParams };
      }
      case Op.between:
        if (!Array.isArray(value) || value.length !== 2) throw new ValidationError('Op.between requires a two-item array', { code: 'SEQ_VALIDATION_OPERATOR' });
        return { sql: `${col} BETWEEN ? AND ?`, params: [this._serializeValue(value[0]), this._serializeValue(value[1])] };
      case Op.notBetween:
        if (!Array.isArray(value) || value.length !== 2) throw new ValidationError('Op.notBetween requires a two-item array', { code: 'SEQ_VALIDATION_OPERATOR' });
        return { sql: `${col} NOT BETWEEN ? AND ?`, params: [this._serializeValue(value[0]), this._serializeValue(value[1])] };
      default:
        throw new ValidationError('Unknown where operator', { code: 'SEQ_VALIDATION_OPERATOR' });
    }
  }

  _whereEntries(where) {
    return [
      ...Object.entries(where),
      ...Object.getOwnPropertySymbols(where).map(symbol => [symbol, where[symbol]])
    ];
  }

  _buildConditions(where, schema, alias = null, translated = false) {
    const colWhere = translated ? where : this._translateWhere(where, schema);
    const params = [];
    const conditions = [];

    for (const [k, v] of this._whereEntries(colWhere)) {
      if (k === Op.and || k === Op.or) {
        const logical = k === Op.and ? 'AND' : 'OR';
        const parts = [];
        for (const item of v) {
          const child = this._buildConditions(item, schema, alias, true);
          if (child.conditions.length === 0) continue;
          parts.push(`(${child.conditions.join(' AND ')})`);
          params.push(...child.params);
        }
        if (parts.length > 0) conditions.push(`(${parts.join(` ${logical} `)})`);
        continue;
      }

      const condition = this._buildCondition(this._colRef(k, alias), v);
      conditions.push(condition.sql);
      params.push(...condition.params);
    }

    return { conditions, params };
  }

  // ---------------------------------------------------------------------------
  // SQL builders — generate standard SQL fragments
  // ---------------------------------------------------------------------------

  /**
   * Builds a WHERE clause from a where object.
   * @param {object} where - Attribute-name where clause
   * @param {object} schema
   * @param {string|null} [alias=null] - Table alias for column references
   * @returns {{ sql: string, params: *[] }}
   */
  _buildWhere(where, schema, alias = null) {
    if (!where) return { sql: '', params: [] };
    const { conditions, params } = this._buildConditions(where, schema, alias);
    if (conditions.length === 0) return { sql: '', params: [] };
    return { sql: ` WHERE ${conditions.join(' AND ')}`, params };
  }

  /**
   * Builds an ORDER BY clause.
   * @param {Array} order - Array of [attr, direction] pairs
   * @param {object} schema
   * @param {string|null} [alias=null] - Table alias for column references
   * @returns {string}
   */
  _buildOrderBy(order, schema, alias = null) {
    if (!order || order.length === 0) return '';
    const clauses = order.map(([attr, dir = 'ASC']) => {
      if (typeof attr !== 'string' || !Object.prototype.hasOwnProperty.call(schema.attrToColumn, attr)
        || typeof dir !== 'string' || !['ASC', 'DESC'].includes(dir.toUpperCase())) {
        throw new ValidationError('Invalid order clause', { code: 'SEQ_VALIDATION_ORDER' });
      }
      const col = schema.attrToColumn[attr] || attr;
      return `${this._colRef(col, alias)} ${dir.toUpperCase()}`;
    });
    return ` ORDER BY ${clauses.join(', ')}`;
  }

  /**
   * Builds a LIMIT/OFFSET clause.
   * @param {object} options
   * @returns {string}
   */
  _buildLimitOffset(options) {
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    }
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
      throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    }
    if (options.limit && options.offset) {
      return ` LIMIT ${options.limit} OFFSET ${options.offset}`;
    } else if (options.limit) {
      return ` LIMIT ${options.limit}`;
    } else if (options.offset) {
      return ` LIMIT -1 OFFSET ${options.offset}`;
    }
    return '';
  }

  _buildSelectList(attributes, schema, alias = null) {
    if (!Array.isArray(attributes) || attributes.length === 0) return '*';
    const virtualAttributes = new Set(schema.virtualAttributes || []);
    const columns = attributes
      .filter(attr => !virtualAttributes.has(attr))
      .map(attr => this._colRef(schema.attrToColumn[attr] || attr, alias));
    return columns.length > 0 ? columns.join(', ') : '*';
  }

  _assertTransaction(options = {}) {
    const active = this._adapter._activeTransaction || null;
    const transaction = options.transaction || null;
    if (transaction) {
      if (!transaction.active || transaction.adapter !== this._adapter || active !== transaction) {
        throw new AdapterError('Transaction does not belong to this adapter or is not active', {
          code: 'SEQ_ADAPTER_TRANSACTION_INVALID'
        });
      }
    } else if (active) {
      throw new AdapterError('An active transaction must be passed in options.transaction', {
        code: 'SEQ_ADAPTER_TRANSACTION_REQUIRED'
      });
    }
  }

  /**
   * Builds a SELECT clause with table-qualified column aliases for JOINs.
   * Format: "alias"."col" AS "alias__col"
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} schema
   * @param {string|null} alias
   * @param {object[]} includes - Normalized include descriptors
   * @returns {string}
   */
  _buildQualifiedSelect(model, schema, alias, includes) {
    const parts = [];
    const aliasPrefix = alias || this._getTableName(model);
    for (const [attrName, colDef] of Object.entries(schema.columns || {})) {
      const colName = schema.attrToColumn[attrName] || attrName;
      parts.push(`${this._colRef(colName, alias)} AS ${this._q(`${aliasPrefix}.${attrName}`)}`);
    }
    for (const inc of includes) {
      if (!inc.model) continue;
      const { schema: incSchema, alias: incAlias } = this._schema(inc.model);
      const incAliasPrefix = inc.as || incAlias || this._getTableName(inc.model);
      const selected = Array.isArray(inc.attributes) && inc.attributes.length > 0
        ? new Set([...inc.attributes, inc.model.primaryKeyAttribute || 'id'])
        : null;
      for (const [attrName, colDef] of Object.entries(incSchema.columns || {})) {
        if (selected && !selected.has(attrName)) continue;
        const colName = incSchema.attrToColumn[attrName] || attrName;
        parts.push(`${this._colRef(colName, incAliasPrefix)} AS ${this._q(`${incAliasPrefix}.${attrName}`)}`);
      }
    }
    return parts.join(', ');
  }

  /**
   * Builds LEFT JOIN clauses for includes.
   * @param {object[]} includes - Normalized include descriptors (eager only)
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {string|null} parentAlias
   * @param {function} resolveIncludeAliasFn - resolveIncludeAlias function
   * @returns {{ sql: string, params: *[] }}
   */
  _buildJoinClause(includes, model, parentAlias, resolveIncludeAliasFn) {
    let sql = '';
    const params = [];
    const { schema: parentSchema } = this._schema(model);
    for (const inc of includes) {
      if (!inc.model) continue;
      const assoc = resolveAssociation(model, inc);
      if (!assoc) continue;
      const { tableName: targetTable, schema: targetSchema, alias: targetAlias } = this._schema(inc.model);
      const joinAlias = inc.as || targetAlias || targetTable;
      const joinType = inc.required ? 'INNER JOIN' : 'LEFT JOIN';
      const fkAttr = assoc.foreignKey;

      if (assoc.type === 'belongsToMany') {
        const throughTable = this._associationThroughTable(assoc);
        const junctionSchema = this._adapter.schemas.get(throughTable);
        if (!junctionSchema) continue;
        const junctionAlias = throughTable;
        const junctionFKCol = junctionSchema.attrToColumn[fkAttr] || fkAttr;
        const junctionOtherKeyCol = junctionSchema.attrToColumn[assoc.otherKey] || assoc.otherKey;
        const pkAttr = model.primaryKeyAttribute || 'id';
        const pkCol = parentSchema.attrToColumn[pkAttr] || pkAttr;
        const targetPKAttr = assoc.target.primaryKeyAttribute || 'id';
        const targetPKCol = targetSchema.attrToColumn[targetPKAttr] || targetPKAttr;

        sql += ` ${joinType} ${this._q(throughTable)} AS ${this._q(junctionAlias)} ON ${this._colRef(pkCol, parentAlias)} = ${this._colRef(junctionFKCol, junctionAlias)}`;

        let onClause = `${this._colRef(junctionOtherKeyCol, junctionAlias)} = ${this._colRef(targetPKCol, joinAlias)}`;
        if (inc.where) {
          const where = this._buildConditions(inc.where, targetSchema, joinAlias);
          onClause += ` AND ${where.conditions.join(' AND ')}`;
          params.push(...where.params);
        }
        sql += ` ${joinType} ${this._q(targetTable)} AS ${this._q(joinAlias)} ON ${onClause}`;
      } else {
        let onClause;
        if (assoc.type === 'belongsTo') {
          const fkCol = parentSchema.attrToColumn[fkAttr] || fkAttr;
          const targetPKAttr = assoc.target.primaryKeyAttribute || 'id';
          const targetPKCol = targetSchema.attrToColumn[targetPKAttr] || targetPKAttr;
          onClause = `${this._colRef(fkCol, parentAlias)} = ${this._colRef(targetPKCol, joinAlias)}`;
        } else {
          const pkAttr = model.primaryKeyAttribute || 'id';
          const pkCol = parentSchema.attrToColumn[pkAttr] || pkAttr;
          const fkCol = targetSchema.attrToColumn[fkAttr] || fkAttr;
          onClause = `${this._colRef(pkCol, parentAlias)} = ${this._colRef(fkCol, joinAlias)}`;
        }
        if (inc.where) {
          const where = this._buildConditions(inc.where, targetSchema, joinAlias);
          onClause += ` AND ${where.conditions.join(' AND ')}`;
          params.push(...where.params);
        }
        sql += ` ${joinType} ${this._q(targetTable)} AS ${this._q(joinAlias)} ON ${onClause}`;
      }
    }
    return { sql, params };
  }

  // ---------------------------------------------------------------------------
  // Abstract execution hooks — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Executes a query and returns all matching rows.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<object[]>}
   */
  async _executeQueryAll(sql, params) {
    throw new AdapterError('DML _executeQuery is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Executes a query and returns a single row.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<object|null>}
   */
  async _executeGet(sql, params) {
    throw new AdapterError('DML _executeGet is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Executes a statement (INSERT, UPDATE, DELETE) and returns result info.
   * @param {string} sql
   * @param {*[]} params
   * @returns {Promise<{ changes: number, lastInsertRowid?: number }>}
   */
  async _execute(sql, params = []) {
    throw new AdapterError('DML _execute is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  /**
   * Maps raw rows to Model instances.
   * @param {object[]} rows
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} schema
   * @returns {import('../../core/Model.js').Model[]}
   */
  _mapRows(rows, model, schema) {
    throw new AdapterError('DML _mapRows is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Template methods — SQL generation + execution hooks
  // ---------------------------------------------------------------------------

  /**
   * Selects all records matching the options.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async selectAll(model, options = {}) {
    this._assertTransaction(options);
    //this._log('DML.selectAll', model.modelName, options);
    const { tableName, schema, alias } = this._schema(model);
    const includes = options.include || [];
    const globalEager = options.eager ?? this._adapter.eager ?? false;
    const eagerIncludes = [];
    const lazyIncludes = [];
    for (const inc of includes) {
      if (resolveEager(inc, globalEager)) {
        eagerIncludes.push(inc);
      } else {
        lazyIncludes.push(inc);
      }
    }
    let queryOptions = options;
    if (eagerIncludes.length > 0 && (options.limit !== undefined || options.offset !== undefined) && model.primaryKeyAttribute) {
      const page = await this.selectAll(model, { ...options, include: [], attributes: [model.primaryKeyAttribute] });
      const ids = page.map(instance => instance.getDataValue(model.primaryKeyAttribute));
      if (ids.length === 0) return [];
      const pageWhere = { [model.primaryKeyAttribute]: { [Op.in]: ids } };
      queryOptions = {
        ...options,
        where: options.where ? { [Op.and]: [options.where, pageWhere] } : pageWhere,
        limit: undefined,
        offset: undefined
      };
    }
    let sql;
    const params = [];
    if (eagerIncludes.length > 0) {
      const qualifiedSelect = this._buildQualifiedSelect(model, schema, alias, eagerIncludes);
      sql = `SELECT ${qualifiedSelect} FROM ${this._q(tableName)}` + (alias ? ` AS ${this._q(alias)}` :``)
      const joins = this._buildJoinClause(eagerIncludes, model, alias, resolveIncludeAlias);
      sql += joins.sql;
      params.push(...joins.params);
    } else {
      const selectList = this._buildSelectList(queryOptions.attributes, schema, alias);
      sql = `SELECT ${selectList} FROM ${this._q(tableName)}` + (alias ? ` AS ${this._q(alias)}` :``)
    }
    const where = this._buildWhere(queryOptions.where, schema, alias);
    sql += where.sql;
    params.push(...where.params);
    sql += this._buildOrderBy(queryOptions.order, schema, alias);
    sql += this._buildLimitOffset(queryOptions);
    const rows = await this._executeQueryAll(sql, params);
    let instances;
    if (eagerIncludes.length > 0) {
      instances = processJoinedRows(rows, model, eagerIncludes, this);
    } else {
      instances = this._mapRows(rows, model, schema, queryOptions);
    }
    if (lazyIncludes.length > 0) {
      instances = await loadIncludes(instances, lazyIncludes, model, this, queryOptions);
    }
    return instances;
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    this._assertTransaction(options);
    //this._log('DML.count', model.modelName, options);
    const { tableName, schema, alias } = this._schema(model);
    let sql = `SELECT COUNT(*) as cnt FROM ${this._q(tableName)}` + (alias ? ` AS ${this._q(alias)}` :``)
    const params = [];
    const where = this._buildWhere(options.where, schema, alias);
    sql += where.sql;
    params.push(...where.params);
    const row = await this._executeGet(sql, params);
    return row.cnt;
  }

  /**
   * Updates records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async update(model, values, options = {}) {
    this._assertTransaction(options);
    //this._log('DML.update', model.modelName, values, options);
    const { tableName, schema } = this._schema(model);
    const colValues = this._toColumnNames(values, schema);
    this._applyTimestamps(colValues, schema);
    this._validateMutationValues(colValues, schema, model.modelName);
    if (Object.keys(colValues).length === 0) return [];
    let primaryKeys = null;
    if (schema.primaryKeyAttribute) {
      const matches = await this.selectAll(model, { where: options.where, attributes: [schema.primaryKeyAttribute], transaction: options.transaction });
      primaryKeys = matches.map(instance => instance.getDataValue(schema.primaryKeyAttribute));
      if (primaryKeys.length === 0) return [];
    }
    const setClauses = Object.keys(colValues).map(k => `${this._q(k)} = ?`);
    const params = [...Object.values(colValues).map(v => this._serializeValue(v))];
    const where = this._buildWhere(options.where, schema);
    const sql = `UPDATE ${this._q(tableName)} SET ${setClauses.join(', ')}${where.sql}`;
    params.push(...where.params);
    await this._execute(sql, params);
    if (primaryKeys) {
      return this.selectAll(model, { ...options, where: { [schema.primaryKeyAttribute]: { [Op.in]: primaryKeys } } });
    }
    if (options.where) return await this.selectAll(model, options);
    return [];
  }

  /**
   * Deletes records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async delete(model, options = {}) {
    this._assertTransaction(options);
    //this._log('DML.delete', model.modelName, options);
    const { tableName, schema } = this._schema(model);
    const params = [];
    const where = this._buildWhere(options.where, schema);
    const sql = `DELETE FROM ${this._q(tableName)}${where.sql}`;
    params.push(...where.params);
    const info = await this._execute(sql, params);
    return info.changes;
  }

  // ---------------------------------------------------------------------------
  // Template methods — insert
  // ---------------------------------------------------------------------------

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    //this._log('DML.insert', model.modelName, values);
    const { tableName, schema } = this._schema(model);
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) {
      delete colRecord[schema.autoIncrement];
    }
    this._validateRecord(colRecord, schema, model.modelName);
    const cols = Object.keys(colRecord);
    if (cols.length === 0) {
      const info = await this._execute(`INSERT INTO ${this._q(tableName)} DEFAULT VALUES`, []);
      if (schema.primaryKey) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      return new model(this._toAttrNames(colRecord, schema), { _isNew: false });
    }
    const colNames = cols.map(c => this._q(c)).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
    const params = cols.map(c => this._serializeValue(colRecord[c]));
    const info = await this._execute(sql, params);
    if (schema.primaryKey && !colRecord[schema.primaryKey]) {
      colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
    }
    const attrRecord = this._toAttrNames(colRecord, schema);
    return new model(attrRecord, { _isNew: false });
  }

  /**
   * Inserts multiple records.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object[]} records
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   */
  async bulkInsert(model, records, options = {}) {
    this._assertTransaction(options);
    const results = [];
    for (const rec of records) {
      results.push(await this.insert(model, rec, options));
    }
    return results;
  }

  /**
   * Truncates all records in a table.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async truncate(model, options = {}) {
    //this._log('DML.truncate', model.modelName);
    throw new AdapterError('DML truncate is not implemented by this adapter', { code: 'SEQ_DML_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // High-level methods — delegate to selectAll
  // ---------------------------------------------------------------------------

  /**
   * Selects a record by primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectByPk(model, id, options = {}) {
    if (!model.primaryKeyAttribute) {
      throw new AdapterError(`Model "${model.modelName}" has no primary key`, { code: 'SEQ_DML_NO_PRIMARY_KEY' });
    }
    const where = { [model.primaryKeyAttribute]: id };
    const results = await this.selectAll(model, { ...options, where, limit: 1, offset: 0 });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Selects one record matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectOne(model, options = {}) {
    const results = await this.selectAll(model, { ...options, limit: 1, offset: 0 });
    return results.length > 0 ? results[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Translation helpers — attribute ↔ column name mapping
  // ---------------------------------------------------------------------------

  /**
   * Translates a record from attribute names to column names.
   * @param {object} record
   * @param {object} schema
   * @returns {object}
   */
  _toColumnNames(record, schema) {
    const result = {};
    const map = schema.attrToColumn;
    const virtualAttributes = new Set(schema.virtualAttributes || []);
    for (const [key, value] of Object.entries(record)) {
      if (virtualAttributes.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        throw new ValidationError(`Unknown attribute "${key}"`, {
          code: 'SEQ_VALIDATION_UNKNOWN_ATTRIBUTE',
          details: { field: key, model: schema.modelName }
        });
      }
      result[map[key] || key] = value;
    }
    return result;
  }

  /**
   * Translates a record from column names to attribute names.
   * @param {object} record
   * @param {object} schema
   * @returns {object}
   */
  _toAttrNames(record, schema) {
    const result = {};
    const map = schema.columnToAttr;
    for (const [key, value] of Object.entries(record)) {
      result[map[key] || key] = value;
    }
    return result;
  }

  /**
   * Translates a where clause from attribute names to column names.
   * @param {object} where
   * @param {object} schema
   * @returns {object}
   */
  _translateWhere(where, schema) {
    const result = {};
    const map = schema.attrToColumn;

    for (const [key, value] of this._whereEntries(where)) {
      if (key === Op.and || key === Op.or) {
        if (!Array.isArray(value)) throw new ValidationError('Logical operators require an array', { code: 'SEQ_VALIDATION_OPERATOR' });
        result[key] = value.map(item => this._translateWhere(item, schema));
      } else {
        if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(map, key)) {
          throw new ValidationError(`Unknown where attribute "${String(key)}"`, {
            code: 'SEQ_VALIDATION_UNKNOWN_ATTRIBUTE',
            details: { field: String(key), model: schema.modelName }
          });
        }
        result[map[key] || key] = value;
      }
    }

    return result;
  }

  /**
   * Matches a column-name record against a column-name where clause.
   * @param {object} record
   * @param {object} where
   * @returns {boolean}
   */
  _matchWhere(record, where) {
    for (const [key, value] of this._whereEntries(where)) {
      if (key === Op.and) {
        if (!value.every(item => this._matchWhere(record, item))) return false;
        continue;
      }
      if (key === Op.or) {
        if (!value.some(item => this._matchWhere(record, item))) return false;
        continue;
      }

      const { op, value: opValue } = resolveWhereValue(value);
      const recordValue = record[key];
      switch (op) {
        case Op.eq:
          if (recordValue !== opValue) return false;
          break;
        case Op.ne:
          if (recordValue === opValue) return false;
          break;
        case Op.gt:
          if (!(recordValue > opValue)) return false;
          break;
        case Op.gte:
          if (!(recordValue >= opValue)) return false;
          break;
        case Op.lt:
          if (!(recordValue < opValue)) return false;
          break;
        case Op.lte:
          if (!(recordValue <= opValue)) return false;
          break;
        case Op.like: {
          const regex = this._likeRegex(opValue);
          if (!regex.test(String(recordValue))) return false;
          break;
        }
        case Op.notLike: {
          const regex = this._likeRegex(opValue);
          if (regex.test(String(recordValue))) return false;
          break;
        }
        case Op.in:
          if (!opValue.includes(recordValue)) return false;
          break;
        case Op.notIn:
          if (opValue.includes(recordValue)) return false;
          break;
        case Op.between:
          if (recordValue < opValue[0] || recordValue > opValue[1]) return false;
          break;
        case Op.notBetween:
          if (recordValue >= opValue[0] && recordValue <= opValue[1]) return false;
          break;
        default:
          if (recordValue !== opValue) return false;
      }
    }
    return true;
  }

  _likeRegex(pattern) {
    if (typeof pattern !== 'string') throw new ValidationError('LIKE operators require a string', { code: 'SEQ_VALIDATION_OPERATOR' });
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replaceAll('%', '.*').replaceAll('_', '.')}$`, 'i');
  }

  /**
   * Validates a column-name record against the schema.
   * @param {object} record - Record with column names
   * @param {object} schema
   * @param {string} modelName
   */
  _validateRecord(record, schema, modelName) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;

      if (schema.autoIncrement && colName === schema.autoIncrement) {
        continue;
      }

      const value = record[colName];

      if (!colDef.allowNull && (value === null || value === undefined)) {
        throw new ValidationError(
          `Field "${attrName}" does not allow null values in model "${modelName}"`,
          {
            code: 'SEQ_VALIDATION_NOT_NULL',
            details: { model: modelName, field: attrName }
          }
        );
      }

      if (value !== null && value !== undefined && colDef.type && typeof colDef.type.validate === 'function') {
        const result = colDef.type.validate(value);
        if (!result.valid) {
          throw new ValidationError(
            `Validation failed for field "${attrName}" in model "${modelName}": ${result.message}`,
            {
              code: 'SEQ_VALIDATION_TYPE',
              details: { model: modelName, field: attrName, value }
            }
          );
        }
      }

      if (typeof value === 'string' && colDef.type?.options?.length) {
        if (value.length > colDef.type.options.length) {
          throw new ValidationError(
            `Field "${attrName}" exceeds maximum ${colDef.type.options.length} characters in model "${modelName}"`,
            {
              code: 'SEQ_VALIDATION_LENGTH',
              details: { model: modelName, field: attrName, maxLength: colDef.type.options.length, actualLength: value.length }
            }
          );
        }
      }

      if (value !== null && value !== undefined && colDef.validate) {
        this._validateCustomRules(value, colDef.validate, attrName, modelName);
      }
    }
  }

  _validateMutationValues(record, schema, modelName) {
    for (const [attrName, colDef] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      if (!Object.prototype.hasOwnProperty.call(record, colName)) continue;
      const value = record[colName];
      if (!colDef.allowNull && (value === null || value === undefined)) {
        throw new ValidationError(`Field "${attrName}" does not allow null values in model "${modelName}"`, {
          code: 'SEQ_VALIDATION_NOT_NULL', details: { model: modelName, field: attrName }
        });
      }
      if (value !== null && value !== undefined && colDef.type?.validate) {
        const result = colDef.type.validate(value);
        if (!result.valid) throw new ValidationError(
          `Validation failed for field "${attrName}" in model "${modelName}": ${result.message}`,
          { code: 'SEQ_VALIDATION_TYPE', details: { model: modelName, field: attrName, value } }
        );
      }
      if (value !== null && value !== undefined && colDef.validate) {
        this._validateCustomRules(value, colDef.validate, attrName, modelName);
      }
    }
  }

  _validateCustomRules(value, rules, attrName, modelName) {
    if (rules.len) {
      const [min, max] = rules.len;
      const length = String(value).length;
      if (length < min || length > max) {
        throw new ValidationError(
          `Field "${attrName}" length must be between ${min} and ${max} characters in model "${modelName}"`,
          {
            code: 'SEQ_VALIDATION_LEN',
            details: { model: modelName, field: attrName, min, max, actualLength: length }
          }
        );
      }
    }

    if (rules.isEmail) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof value !== 'string' || !emailPattern.test(value)) {
        throw new ValidationError(
          `Field "${attrName}" must be a valid email in model "${modelName}"`,
          {
            code: 'SEQ_VALIDATION_EMAIL',
            details: { model: modelName, field: attrName, value }
          }
        );
      }
    }
  }
}
