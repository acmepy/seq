import { ModelRegistry } from './ModelRegistry.js';
import { ConfigurationError } from './errors/ConfigurationError.js';
import { applyConvention, applyCase } from '../utils/naming.js';

/**
 * Main Seq ORM class. Entry point for creating an ORM instance.
 */
export class Seq {
  /**
   * @param {object} options - Configuration options
   * @param {import('../adapters/BaseAdapter.js').BaseAdapter} options.adapter - The adapter to use
   * @param {Array} [options.models=[]] - Model classes to register
   * @param {boolean|function} [options.logging=false] - Logging configuration
   * @param {object} [options.define={}] - Default model definition options
   * @param {object} [options.naming={}] - Naming convention options
   * @param {string} [options.naming.tables] - Table name convention: 'camelCase' | 'snake_case'
   * @param {string} [options.naming.columns] - Column name convention: 'camelCase' | 'snake_case'
   * @param {string} [options.naming.prefix] - Global prefix for table names
   */
  constructor(options = {}) {
    if (!options.adapter) {
      throw new ConfigurationError('An adapter is required', {
        code: 'SEQ_MISSING_ADAPTER'
      });
    }

    this._adapter = options.adapter;
    this._logging = options.logging || false;
    this._define = options.define || {};
    this._naming = options.naming || {};
    this._registry = new ModelRegistry();
    this._initialized = false;
    this._modelClasses = options.models || [];
  }

  /**
   * Returns the active adapter.
   * @returns {import('../adapters/BaseAdapter.js').BaseAdapter}
   */
  get adapter() {
    return this._adapter;
  }

  /**
   * Returns all registered models.
   * @returns {Array}
   */
  get models() {
    return this._registry.all();
  }

  /**
   * Returns the virtual database from the adapter.
   * @returns {Promise<object>}
   */
  async database() {
    return this._adapter.inspectDatabase();
  }

  /**
   * Initializes the ORM: validates config, registers models, initializes adapter.
   */
  async init() {
    await this._adapter.connect();
    await this._adapter.initialize();

    // Phase 1: Initialize models (define/init) so they have modelName set
    for (const modelClass of this._modelClasses) {
      if (modelClass.attributes && modelClass.options) {
        // Option B: static attributes/options
        modelClass.init(modelClass.attributes, {
          ...modelClass.options,
          seq: this
        });
      } else if (!modelClass.seq) {
        // Option A: static define() method
        if (modelClass.define && modelClass.define !== Function.prototype.define) {
          modelClass.define(this);
        }
      }
      if (!modelClass.seq) modelClass.seq = this;
    }

    // Phase 1.5: Resolve table names so DML operations use correct names
    for (const modelClass of this._modelClasses) {
      modelClass._resolvedTableName = this._resolveTableName(modelClass);
    }

    // Phase 2: Register models (now that modelName is set)
    for (const modelClass of this._modelClasses) {
      this.registerModel(modelClass);
    }

    this._initialized = true;
    this._log('Seq initialized');
  }

  /**
   * Registers a model class.
   * @param {typeof import('./Model.js').Model} modelClass
   */
  registerModel(modelClass) {
    this._registry.register(modelClass);
  }

  /**
   * Gets a model by name.
   * @param {string} name
   * @returns {typeof import('./Model.js').Model|undefined}
   */
  getModel(name) {
    return this._registry.get(name);
  }

  /**
   * Checks if a model is registered.
   * @param {string} name
   * @returns {boolean}
   */
  hasModel(name) {
    return this._registry.has(name);
  }

  /**
   * Syncs models to the virtual database (creates missing tables).
   * @param {object} [options={}]
   * @param {boolean} [options.force=false] - Drop and recreate tables
   * @param {boolean} [options.alter=false] - Alter existing tables
   * @returns {Promise<{created: string[], existing: string[], altered: string[], dropped: string[]}>}
   */
  async sync(options = {}) {
    const { force = false, alter = false } = options;
    const result = { created: [], existing: [], altered: [], dropped: [] };
    const existingTables = await this._adapter.ddl.listTables();

    for (const modelClass of this._registry.all()) {
      const definition = this._buildTableDefinition(modelClass);
      const tableName = definition.tableName;

      if (existingTables.includes(tableName)) {
        if (force) {
          await this._adapter.ddl.dropTable(tableName);
          await this._adapter.ddl.createTable(definition);
          result.dropped.push(tableName);
          result.created.push(tableName);
        } else if (alter) {
          const altered = await this._adapter.ddl.alterTable(tableName, definition);
          if (altered) {
            result.altered.push(tableName);
          } else {
            result.existing.push(tableName);
          }
        } else {
          result.existing.push(tableName);
        }
      } else {
        await this._adapter.ddl.createTable(definition);
        result.created.push(tableName);
      }
    }

    this._log('Sync complete:', result);
    return result;
  }

  /**
   * Executes a transactional callback.
   * @param {function} callback - Async function receiving a transaction object
   * @returns {Promise<*>}
   */
  async transaction(callback) {
    const transaction = await this._adapter.tcl.begin();
    try {
      const result = await callback(transaction);
      await this._adapter.tcl.commit(transaction);
      return result;
    } catch (error) {
      await this._adapter.tcl.rollback(transaction);
      throw error;
    }
  }

  /**
   * Closes the adapter connection.
   */
  async close() {
    await this._adapter.close();
    this._initialized = false;
  }

  /**
   * Resolves the effective table name for a model.
   * Applies naming convention, prefix, and adapter case style.
   * @param {typeof import('./Model.js').Model} modelClass
   * @returns {string}
   * @private
   */
  _resolveTableName(modelClass) {
    if (modelClass._tableNameExplicit) {
      return modelClass.tableName;
    }

    const convention = this._naming.tables;
    const prefix = this._naming.prefix;
    const caseStyle = this._adapter.caseStyle;

    if (!convention) {
      return modelClass.modelName;
    }

    let name = applyConvention(modelClass.modelName, convention);
    if (prefix) {
      name = `${prefix}_${name}`;
    }
    return applyCase(name, caseStyle);
  }

  /**
   * Resolves the effective column name for an attribute.
   * Applies naming convention and adapter case style.
   * @param {object} def - Attribute definition
   * @param {string} attrName - Attribute name
   * @returns {string}
   * @private
   */
  _resolveColumnName(def, attrName) {
    if (def.field) {
      return def.field;
    }

    const convention = this._naming.columns;
    const caseStyle = this._adapter.caseStyle;

    if (!convention) {
      return attrName;
    }

    return applyCase(applyConvention(attrName, convention), caseStyle);
  }

  /**
   * Builds a table definition from a model class for DDL operations.
   * @param {typeof import('./Model.js').Model} modelClass
   * @returns {object}
   * @private
   */
  _buildTableDefinition(modelClass) {
    const attributes = modelClass.rawAttributes || {};
    const columns = {};
    const attrToColumn = {};
    const columnToAttr = {};

    for (const [name, def] of Object.entries(attributes)) {
      const columnName = this._resolveColumnName(def, name);
      attrToColumn[name] = columnName;
      columnToAttr[columnName] = name;

      columns[name] = {
        type: def.type,
        primaryKey: def.primaryKey || false,
        autoIncrement: def.autoIncrement || false,
        allowNull: def.allowNull !== undefined ? def.allowNull : true,
        defaultValue: def.defaultValue,
        unique: def.unique || false,
        field: columnName
      };
    }

    const pkAttr = modelClass.primaryKeyAttribute;
    const aiAttr = modelClass.autoIncrementAttribute;

    const foreignKeys = this._buildForeignKeys(modelClass, attrToColumn);

    return {
      modelName: modelClass.modelName,
      tableName: this._resolveTableName(modelClass),
      columns,
      foreignKeys,
      primaryKey: pkAttr ? attrToColumn[pkAttr] : null,
      autoIncrement: aiAttr ? attrToColumn[aiAttr] : null,
      primaryKeyAttribute: pkAttr || null,
      autoIncrementAttribute: aiAttr || null,
      timestamps: modelClass.options?.timestamps || false,
      createdAt: modelClass.options?.createdAt || 'createdAt',
      updatedAt: modelClass.options?.updatedAt || 'updatedAt',
      attrToColumn,
      columnToAttr
    };
  }

  _buildForeignKeys(modelClass, attrToColumn) {
    const fkMap = new Map();

    const sourceTable = modelClass._resolvedTableName || this._resolveTableName(modelClass);

    const autoConstraintName = (refTable) => `fk_${sourceTable}_${refTable}`;

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
      if (def.references) {
        const refModel = this.getModel(def.references.model);
        if (!refModel) continue;
        const refPkAttr = def.references.key || refModel.primaryKeyAttribute || 'id';
        const refTable = refModel._resolvedTableName || this._resolveTableName(refModel);
        const refPkCol = this._resolveColumnName(refModel.rawAttributes[refPkAttr] || {}, refPkAttr);
        const fkCol = attrToColumn[attrName] || attrName;
        const constraintName = def.references.constraintName || autoConstraintName(refTable);
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

    const associations = modelClass.associations || {};
    for (const assoc of Object.values(associations)) {
      if (assoc.type === 'belongsTo') {
        const fkAttr = assoc.foreignKey;
        const refPkAttr = assoc.target.primaryKeyAttribute || 'id';
        const refTable = assoc.target._resolvedTableName || this._resolveTableName(assoc.target);
        const refPkCol = this._resolveColumnName(assoc.target.rawAttributes[refPkAttr] || {}, refPkAttr);
        const fkCol = attrToColumn[fkAttr] || fkAttr;
        const constraintName = assoc.constraintName || autoConstraintName(refTable);
        upsertFK(fkCol, {
          attributeName: fkAttr,
          columnName: fkCol,
          constraintName,
          references: { model: assoc.target.modelName, table: refTable, key: refPkAttr, column: refPkCol },
          onDelete: assoc.onDelete,
          onUpdate: assoc.onUpdate
        });
      }
    }

    for (const otherModel of this._registry.all()) {
      if (otherModel === modelClass) continue;
      for (const assoc of Object.values(otherModel.associations || {})) {
        if (assoc.type !== 'hasMany' && assoc.type !== 'hasOne') continue;
        if (assoc.target !== modelClass) continue;
        const fkAttr = assoc.foreignKey;
        if (!modelClass.rawAttributes || !modelClass.rawAttributes[fkAttr]) continue;
        const refPkAttr = assoc.source.primaryKeyAttribute || 'id';
        const refTable = assoc.source._resolvedTableName || this._resolveTableName(assoc.source);
        const refPkCol = this._resolveColumnName(assoc.source.rawAttributes[refPkAttr] || {}, refPkAttr);
        const fkCol = attrToColumn[fkAttr] || fkAttr;
        const constraintName = assoc.constraintName || autoConstraintName(refTable);
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

  /**
   * Logs a message if logging is enabled.
   * @param {...*} args
   * @private
   */
  _log(...args) {
    if (this._logging === true) {
      console.log('[Seq]', ...args);
    } else if (typeof this._logging === 'function') {
      this._logging('[Seq]', ...args);
    }
  }
}
