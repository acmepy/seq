import { tupleKey, valuesFor } from '../../utils/keys.js';
import { AdapterError } from '../../core/errors/AdapterError.js';
import { ValidationError } from '../../core/errors/ValidationError.js';
import { clone } from '../../utils/clone.js';
import { DMLAbstract } from '../abstract/DMLAbstract.js';
import { loadIncludes, trimProjection } from '../../utils/include.js';
import { Op } from '../../operators.js';

/**
 * DML operations for the MapAdapter.
 * Handles insert, select, update, delete, and truncate.
 *
 * Extends DMLAbstract which provides adapter-agnostic helpers:
 * _toColumnNames, _toAttrNames, _translateWhere, _matchWhere, _validateRecord.
 *
 * Records in the database use column names (from `field`).
 * Model instances use attribute names.
 */
export class MapDML extends DMLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  /**
   * Returns the effective table name for a model.
   * Uses _resolvedTableName if set by Seq (convention-applied), otherwise falls back to tableName.
   * @param {typeof import('../../core/Model.js').Model} model
   * @returns {string}
   */
  _getTableName(model) {
    return model._resolvedTableName || model.tableName;
  }

  /**
   * Inserts a single record.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model>}
   */
  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);

    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });

    const colRecord = this._toColumnNames(values, schema);

    if (schema.autoIncrement) {
      const seq = this._adapter.sequences.get(tableName) || 1;
      colRecord[schema.autoIncrement] = seq;
    }

    this._applyDefaults(colRecord, schema);
    for (const [attrName] of Object.entries(schema.columns)) {
      const colName = schema.attrToColumn[attrName] || attrName;
      if (!(colName in colRecord) || colRecord[colName] === undefined) {
        colRecord[colName] = null;
      }
    }
    this._applyTimestamps(colRecord, schema);

    this._validateRecord(colRecord, schema, model.modelName);

    if (schema.primaryKeys?.length || schema.primaryKey) {
      const pkValue = this._recordKey(schema, colRecord);
      if (pkValue !== null && pkValue !== undefined && table.has(pkValue)) {
        throw new AdapterError(
          `Duplicate primary key value "${pkValue}" for model "${model.modelName}"`,
          { code: 'SEQ_VALIDATION_DUPLICATE_PK' }
        );
      }
    }

    this._checkUniqueConstraint(tableName, schema, colRecord);
    this._checkForeignKeyConstraint(schema, colRecord);

    const storedRecord = clone(colRecord);
    if (schema.primaryKeys?.length || schema.primaryKey) {
      table.set(this._recordKey(schema, colRecord), storedRecord);
    } else {
      table.set(table.size, storedRecord);
    }
    if (schema.autoIncrement) this._adapter.sequences.set(tableName, colRecord[schema.autoIncrement] + 1);

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
    const snapshot = this._snapshotState();
    const results = [];
    try {
      for (const record of records) results.push(await this.insert(model, record, options));
      return results;
    } catch (error) {
      this._restoreState(snapshot);
      throw error;
    }
  }

  /**
   * Selects a record by primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectAll(model, options = {}) {
    this._assertTransaction(options);
    const required = this._requiredSourceAttributesForLazyIncludes(model, options.include);
    const filterBeforePaging = options.include?.some(include => include.required) && (options.limit !== undefined || options.offset !== undefined);
    const selection = { ...options, attributes: this._attributesWithRequired(options.attributes, required) };
    if (filterBeforePaging) { selection.limit = undefined; selection.offset = undefined; }
    let instances = await this._select(model, selection);
    if (options.include?.length) instances = await loadIncludes(instances, options.include, model, this, options);
    if (filterBeforePaging) instances = instances.slice(options.offset || 0, options.limit === undefined ? undefined : (options.offset || 0) + options.limit);
    trimProjection(instances, options.attributes, options.include, model);
    return instances;
  }

  /**
   * Internal select implementation.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} options
   * @returns {Promise<import('../../core/Model.js').Model[]>}
   * @private
   */
  async _select(model, options = {}) {
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let results = [];

    for (const [, record] of table) results.push(clone(record));

    if (options.where) {
      const colWhere = this._translateWhere(options.where, schema);
      results = results.filter(record => this._matchWhere(record, colWhere));
    }

    if (options.order) {
      const colOrder = options.order.map(([attr, dir]) => {
        const col = schema?.attrToColumn?.[attr] || attr;
        return [col, dir];
      });
      results.sort((a, b) => {
        for (const [field, direction] of colOrder) {
          const dir = (direction || 'ASC').toUpperCase();
          const aVal = a[field];
          const bVal = b[field];
          if (aVal === bVal) continue;
          if (aVal === null || aVal === undefined) return dir === 'ASC' ? -1 : 1;
          if (bVal === null || bVal === undefined) return dir === 'ASC' ? 1 : -1;
          const cmp = aVal < bVal ? -1 : 1;
          return dir === 'ASC' ? cmp : -cmp;
        }
        return 0;
      });
    }

    if (options.offset) results = results.slice(options.offset);
    if (options.limit) results = results.slice(0, options.limit);

    if (Array.isArray(options.attributes) && options.attributes.length > 0) {
      const virtualAttributes = new Set(schema.virtualAttributes || []);
      const selected = new Set(
        options.attributes
          .filter(attr => !virtualAttributes.has(attr))
          .map(attr => schema.attrToColumn[attr] || attr)
      );
      results = results.map(record => {
        const projected = {};
        for (const key of selected) {
          if (key in record) projected[key] = record[key];
        }
        return projected;
      });
    }

    return results.map(record => {
      const attrRecord = schema ? this._toAttrNames(record, schema) : record;
      return new model(attrRecord, {
        _isNew: false,
        _partial: Array.isArray(options.attributes) && options.attributes.length > 0
      });
    });
  }

  async selectAssociationJunctionRows(assoc, sourceIds, options = {}) {
    this._assertTransaction(options);
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) return [];

    const fkAttr = assoc.foreignKey;
    const otherKeyAttr = assoc.otherKey;

    if (assoc.throughModel) {
      const rows = await this.selectAll(assoc.throughModel, {
        where: { [fkAttr]: { [Op.in]: sourceIds } },
        attributes: [fkAttr, otherKeyAttr],
        transaction: options.transaction
      });
      return rows.map(row => ({
        [fkAttr]: row.getDataValue(fkAttr),
        [otherKeyAttr]: row.getDataValue(otherKeyAttr)
      }));
    }

    const throughTable = this._adapter.getAssociationThroughTable(assoc);
    const table = this._adapter.database.get(throughTable);
    const schema = this._adapter.schemas.get(throughTable);
    if (!table || !schema) {
      throw new AdapterError(`Table "${throughTable}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }

    const fkCol = schema.attrToColumn[fkAttr] || fkAttr;
    const otherKeyCol = schema.attrToColumn[otherKeyAttr] || otherKeyAttr;
    const sourceSet = new Set(sourceIds);
    const tenantWhere = this._translateWhere(this._junctionTenantWhere(assoc) || {}, schema);
    const rows = [];

    for (const [, record] of table) {
      if (!sourceSet.has(record[fkCol])) continue;
      if (!this._matchWhere(record, tenantWhere)) continue;
      rows.push({
        [fkAttr]: record[fkCol],
        [otherKeyAttr]: record[otherKeyCol]
      });
    }

    return rows;
  }

  /**
   * Counts records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async count(model, options = {}) {
    this._assertTransaction(options);
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let count = 0;

    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    for (const [, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          count++;
        }
      } else {
        count++;
      }
    }

    return count;
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
    const snapshot = this._snapshotState();
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    const updatedInstances = [];
    const now = new Date();

    const colValues = this._toColumnNames(values, schema);
    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    const toUpdate = [];
    for (const [key, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          toUpdate.push({ key, record });
        }
      } else {
        toUpdate.push({ key, record });
      }
    }

    try {
      for (const { key, record } of toUpdate) {
      const oldRecord = clone(record);
      for (const [colName, value] of Object.entries(colValues)) {
        record[colName] = value;
      }

      if (schema?.timestamps && schema.updatedAt) {
        const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
        record[updatedCol] = now;
      }

      const newKey = schema.primaryKeys?.length || schema.primaryKey ? this._recordKey(schema, record) : key;
      if (newKey !== key && table.has(newKey)) {
        throw new ValidationError(`Duplicate primary key value "${newKey}" for model "${model.modelName}"`, {
          code: 'SEQ_VALIDATION_DUPLICATE_PK'
        });
      }
      this._checkUniqueConstraint(tableName, schema, record, key);
      this._checkForeignKeyConstraint(schema, record);
      this._handleCascadeOnUpdate(model, schema, record, oldRecord);

      if (schema) {
        this._validateRecord(record, schema, model.modelName);
      }

      const attrRecord = schema ? this._toAttrNames(clone(record), schema) : clone(record);
      updatedInstances.push(new model(attrRecord, { _isNew: false }));
      if (newKey !== key) {
        table.delete(key);
        table.set(newKey, record);
      }
      }
      return updatedInstances;
    } catch (error) {
      this._restoreState(snapshot);
      throw error;
    }
  }

  /**
   * Deletes records matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  async delete(model, options = {}) {
    this._assertTransaction(options);
    const snapshot = this._snapshotState();
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    const schema = this._adapter.schemas.get(tableName);
    let count = 0;

    const colWhere = options.where ? this._translateWhere(options.where, schema) : null;

    const keysToDelete = [];
    for (const [key, record] of table) {
      if (colWhere) {
        if (this._matchWhere(record, colWhere)) {
          keysToDelete.push(key);
        }
      } else {
        keysToDelete.push(key);
      }
    }

    try {
      for (const key of keysToDelete) {
        const record = table.get(key);
        if (!record) continue;
        this._handleCascadeOnDelete(model, schema, record);
        table.delete(key);
        count++;
      }
      return count;
    } catch (error) {
      this._restoreState(snapshot);
      throw error;
    }
  }

  /**
   * Truncates all records in a table.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const tableName = this._getTableName(model);
    const table = this._adapter.database.get(tableName);
    table.clear();
    this._adapter.sequences.set(tableName, 1);
  }

  _checkUniqueConstraint(tableName, schema, colRecord, excludePk) {
    const table = this._adapter.database.get(tableName);
    if (!table) return;

    for (const uk of (schema.uniqueConstraints || [])) {
      const colValues = uk.columns.map(col => colRecord[col]);
      if (colValues.some(v => v === null || v === undefined)) continue;

      for (const [pk, existing] of table) {
        if (excludePk !== undefined && pk === excludePk) continue;
        const existingValues = uk.columns.map(col => existing[col]);
        if (colValues.every((v, i) => v === existingValues[i])) {
          throw new ValidationError(
            `Duplicate value for unique constraint "${uk.constraintName}" on [${uk.columns.join(', ')}] in model "${schema.modelName || tableName}"`,
            {
              code: 'SEQ_VALIDATION_UNIQUE',
              details: { model: schema.modelName || tableName, constraintName: uk.constraintName, columns: uk.columns, value: colValues.length === 1 ? colValues[0] : colValues }
            }
          );
        }
      }
    }
  }

  _recordKey(schema, record) {
    const columns = schema.primaryKeys?.length ? schema.primaryKeys : [schema.primaryKey];
    return columns.length === 1 ? record[columns[0]] : tupleKey(valuesFor(record, columns));
  }

  _checkForeignKeyConstraint(schema, record) {
    for (const fk of schema.foreignKeys || []) {
      const columns = fk.columnNames || [fk.columnName];
      const values = valuesFor(record, columns);
      if (values.some(value => value === null || value === undefined)) continue;
      const referenced = this._adapter.database.get(fk.references.table);
      if (!referenced) continue;
      const refColumns = fk.references.columns || [fk.references.column];
      if (![...referenced.values()].some(row => refColumns.every((column, index) => row[column] === values[index]))) {
        throw new ValidationError('Foreign key constraint "' + fk.constraintName + '": referenced record does not exist', {
          code: 'SEQ_VALIDATION_FK', details: { model: schema.modelName, field: fk.attributeName, value: values.length === 1 ? values[0] : values, constraintName: fk.constraintName, referencesModel: fk.references.model, referencesKey: fk.references.key }
        });
      }
    }
  }

  _handleCascadeOnDelete(model, schema, record, visited = new Set()) {
    const tableName = this._getTableName(model);
    const identity = tupleKey([tableName, this._recordKey(schema, record)]);
    if (visited.has(identity)) return;
    visited.add(identity);
    for (const [otherTableName, otherSchema] of this._adapter.schemas) {
      const otherTable = this._adapter.database.get(otherTableName);
      for (const fk of otherSchema.foreignKeys || []) {
        if (fk.references.table !== tableName) continue;
        const refs = fk.references.columns || [fk.references.column];
        const columns = fk.columnNames || [fk.columnName];
        for (const [key, child] of [...otherTable]) {
          if (!columns.every((column, index) => child[column] != null && child[column] === record[refs[index]])) continue;
          if (fk.onDelete === 'CASCADE') {
            this._handleCascadeOnDelete({ tableName: otherTableName }, otherSchema, child, visited);
            otherTable.delete(key);
          } else if (fk.onDelete === 'SET NULL') {
            for (const column of columns) child[column] = null;
            this._validateRecord(child, otherSchema, otherSchema.modelName);
          } else throw new ValidationError('Cannot delete: record is referenced via constraint "' + fk.constraintName + '"', { code: 'SEQ_VALIDATION_FK_RESTRICT', details: { model: otherSchema.modelName, field: fk.attributeName, constraintName: fk.constraintName } });
        }
      }
    }
  }

  _handleCascadeOnUpdate(model, schema, record, oldRecord, visited = new Set()) {
    const tableName = this._getTableName(model);
    const identity = tupleKey([tableName, this._recordKey(schema, oldRecord)]);
    if (visited.has(identity)) return;
    visited.add(identity);
    for (const [otherTableName, otherSchema] of this._adapter.schemas) {
      const otherTable = this._adapter.database.get(otherTableName);
      for (const fk of otherSchema.foreignKeys || []) {
        if (fk.references.table !== tableName) continue;
        const refs = fk.references.columns || [fk.references.column];
        if (refs.every(column => record[column] === oldRecord[column])) continue;
        const columns = fk.columnNames || [fk.columnName];
        for (const [key, child] of [...otherTable]) {
          if (!columns.every((column, index) => child[column] != null && child[column] === oldRecord[refs[index]])) continue;
          if (fk.onUpdate !== 'CASCADE' && fk.onUpdate !== 'SET NULL') throw new ValidationError('Cannot update: record is referenced via constraint "' + fk.constraintName + '"', { code: 'SEQ_VALIDATION_FK_RESTRICT', details: { model: otherSchema.modelName, field: fk.attributeName, constraintName: fk.constraintName } });
          const previous = clone(child);
          columns.forEach((column, index) => { child[column] = fk.onUpdate === 'CASCADE' ? record[refs[index]] : null; });
          this._validateRecord(child, otherSchema, otherSchema.modelName);
          this._checkUniqueConstraint(otherTableName, otherSchema, child, key);
          this._checkForeignKeyConstraint(otherSchema, child);
          const nextKey = otherSchema.primaryKeys?.length || otherSchema.primaryKey ? this._recordKey(otherSchema, child) : key;
          if (nextKey !== key && otherTable.has(nextKey)) throw new ValidationError('Duplicate primary key value', { code: 'SEQ_VALIDATION_DUPLICATE_PK' });
          this._handleCascadeOnUpdate({ tableName: otherTableName }, otherSchema, child, previous, visited);
          if (nextKey !== key) { otherTable.delete(key); otherTable.set(nextKey, child); }
        }
      }
    }
  }

  _snapshotState() {
    const database = new Map();
    for (const [tableName, table] of this._adapter.database) {
      database.set(tableName, new Map([...table].map(([key, record]) => [key, clone(record)])));
    }
    return { database, sequences: new Map(this._adapter.sequences) };
  }

  _restoreState(snapshot) {
    this._adapter.database = snapshot.database;
    this._adapter.sequences = snapshot.sequences;
  }
}
