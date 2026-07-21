import { ModelRegistry } from './ModelRegistry.js';
import { Model } from './Model.js';
import { ConfigurationError } from './errors/ConfigurationError.js';
import { applyConvention, applyCase } from '../utils/naming.js';

/**
 * Main Seq ORM class. Entry point for creating an ORM instance.
 */
export class Seq {
  /**
   * @param {import('../../types/index.d.ts').SeqOptions} options - Configuration options.
   */
  constructor(options = {}) {
    if (!options.adapter) throw new ConfigurationError('An adapter is required', {code: 'SEQ_MISSING_ADAPTER'});
    this._adapter = options.adapter;
    this._adapter._seq = this;
    this._logging = this._normalizeLogging(options.logging);
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
   * The result behaves as an array and also exposes models by model/table name.
   * @returns {import('../../types/index.d.ts').ModelStatic[] & Record<string, import('../../types/index.d.ts').ModelStatic>}
   */
  get models() {
    return this._buildModelMap(this._registry.all());
  }

  /**
   * Returns the virtual database from the adapter.
   * @returns {Promise<object>}
   */
  async database() {
    return this._adapter.inspectDatabase();
  }

  /**
   * Validates that the configured adapter can reach its data source.
   * @returns {Promise<boolean>}
   */
  async authenticate() {
    const result = typeof this._adapter.authenticate === 'function' ? await this._adapter.authenticate() : (await this._adapter.connect(), true);
    if (!this._initialized) await this.init();
    return result;
  }

  /**
   * Initializes the ORM: validates config, registers models, initializes adapter.
   */
  async init() {
    if (this._initialized) return;

    await this._adapter.connect();
    await this._adapter.initialize();

    // Phase 1: Initialize models (define/init) so they have modelName set
    for (const modelClass of this._modelClasses) {
      if (modelClass.attributes && modelClass.options) {
        // Option B: static attributes/options
        modelClass.init(modelClass.attributes, { ...modelClass.options, seq: this});
      } else if (!modelClass.seq) {
        // Option A: static define() method
        if (modelClass.define && modelClass.define !== Function.prototype.define) modelClass.define(this);
      }
      if (!modelClass.seq) modelClass.seq = this;
    }

    // Phase 1.5: Resolve table names so DML operations use correct names
    for (const modelClass of this._modelClasses)  modelClass._resolvedTableName = this._resolveTableName(modelClass);

    // Phase 2: Register models (now that modelName is set)
    for (const modelClass of this._modelClasses) this.registerModel(modelClass);
    this._runModelAssociations();
    this._initialized = true;
    this._log('info', 'Seq initialized');
  }

  /**
   * Registers a model class.
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   */
  registerModel(modelClass) {
    this._registry.register(modelClass);
  }

  /**
   * Defines and registers a model using a Sequelize-like API.
   * @param {string} modelName
   * @param {import('../../types/index.d.ts').AttributeMap} attributes
   * @param {import('../../types/index.d.ts').ModelOptions} [options={}]
   * @returns {typeof Model}
   */
  define(modelName, attributes, options = {}) {
    function DefinedModel(values = {}, options = {}) {
      if (!new.target) return new DefinedModel(values, options);
      return Reflect.construct(Model, [values, options], new.target);
    }

    Object.setPrototypeOf(DefinedModel, Model);
    Object.defineProperty(DefinedModel, 'name', {value: modelName, configurable: true});
    DefinedModel.prototype = Object.create(Model.prototype, {constructor: {value: DefinedModel, writable: true, configurable: true}});

    DefinedModel.init(attributes, {...this._define, ...options, modelName, seq: this});
    this._copyModelStatics(DefinedModel);

    if (!this._modelClasses.includes(DefinedModel)) this._modelClasses.push(DefinedModel);
    if (this._initialized) {
      DefinedModel._resolvedTableName = this._resolveTableName(DefinedModel);
      this.registerModel(DefinedModel);
      this._runModelAssociations();
    }

    return DefinedModel;
  }

  _copyModelStatics(modelClass) {
    for (const key of Object.getOwnPropertyNames(Model)) {
      if (['length', 'name', 'prototype'].includes(key)) continue;
      if (Object.prototype.hasOwnProperty.call(modelClass, key)) continue;
      Object.defineProperty(modelClass, key, Object.getOwnPropertyDescriptor(Model, key));
    }
  }

  _buildModelMap(models) {
    const result = [...models];
    for (const model of models) {
      result[model.modelName] = model;
      if (model.tableName && !result[model.tableName]) result[model.tableName] = model;
    }
    return result;
  }

  _runModelAssociations() {
    const models = this.models;
    for (const modelClass of this._registry.all()) {
      if (typeof modelClass.associate !== 'function' || modelClass._associationsApplied) continue;
      modelClass.associate(models);
      modelClass._associationsApplied = true;
    }
  }

  /**
   * Gets a model by name.
   * @param {string} name
   * @returns {import('../../types/index.d.ts').ModelStatic|undefined}
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
   * @returns {Promise<import('../../types/index.d.ts').SyncResult>}
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

    const junctions = this._buildJunctionTables();
    for (const assoc of junctions) {
      const through = this._getAssociationThroughTable(assoc);
      if (existingTables.includes(through)) {
        if (force) {
          await this._adapter.ddl.dropTable(through);
          await this._adapter.ddl.createTable(this._buildJunctionTableDefinition(assoc));
          result.dropped.push(through);
          result.created.push(through);
        } else {
          result.existing.push(through);
        }
      } else {
        await this._adapter.ddl.createTable(this._buildJunctionTableDefinition(assoc));
        result.created.push(through);
      }
    }

    this._log('info', 'Sync complete');
    return result;
  }

  /**
   * Executes a transactional callback.
   * @template TResult
   * @param {function(*): Promise<TResult>|TResult} callback - Function receiving a transaction object.
   * @returns {Promise<TResult>}
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
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   * @returns {string}
   * @private
   */
  _resolveTableName(modelClass) {
    if (modelClass._tableNameExplicit) return modelClass.tableName;

    const convention = this._naming.tables;
    const prefix = this._naming.prefix;
    const caseStyle = this._adapter.caseStyle;
    if (!convention) return modelClass.modelName;
    let name = applyConvention(modelClass.modelName, convention);
    if (prefix) name = `${prefix}_${name}`;
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
    if (def.field) return def.field;
    const convention = this._naming.columns;
    const caseStyle = this._adapter.caseStyle;
    if (!convention) return attrName;
    return applyCase(applyConvention(attrName, convention), caseStyle);
  }

  /**
   * Builds a table definition from a model class for DDL operations.
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   * @returns {object}
   * @private
   */
  _buildTableDefinition(modelClass) {
    const attributes = modelClass.rawAttributes || {};
    const columns = {};
    const uniqueConstraints = [];
    const attrToColumn = {};
    const columnToAttr = {};
    const virtualAttributes = [];

    const sourceTable = modelClass._resolvedTableName || this._resolveTableName(modelClass);

    for (const [name, def] of Object.entries(attributes)) {
      if (modelClass._isVirtualAttribute?.(def)) {
        virtualAttributes.push(name);
        continue;
      }
      const columnName = this._resolveColumnName(def, name);
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

      if (def.unique)  uniqueConstraints.push({columns: [columnName], constraintName: `uk_${sourceTable}_${columnName}`});
    }

    const pkAttr = modelClass.primaryKeyAttribute;
    const aiAttr = modelClass.autoIncrementAttribute;

    const foreignKeys = this._buildForeignKeys(modelClass, attrToColumn);

    return {
      modelName: modelClass.modelName,
      tableName: sourceTable,
      columns,
      uniqueConstraints,
      indexes: [],
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

  /**
   * Builds a table definition for a belongsToMany junction/pivot table.
   * @param {import('./Association.js').Association} assoc
   * @returns {object}
   * @private
   */
  _buildJunctionTableDefinition(assoc) {
    const source = assoc.source;
    const target = assoc.target;
    const through = this._getAssociationThroughTable(assoc);
    const fkAttr = assoc.foreignKey;
    const otherKeyAttr = assoc.otherKey;

    const sourcePKAttr = source.primaryKeyAttribute || 'id';
    const sourcePKDef = source.rawAttributes[sourcePKAttr] || {};
    const sourcePKType = sourcePKDef.type;
    const sourcePKCol = this._resolveColumnName(sourcePKDef, sourcePKAttr);

    const targetPKAttr = target.primaryKeyAttribute || 'id';
    const targetPKDef = target.rawAttributes[targetPKAttr] || {};
    const targetPKType = targetPKDef.type;
    const targetPKCol = this._resolveColumnName(targetPKDef, targetPKAttr);

    const sourceTable = source._resolvedTableName || this._resolveTableName(source);
    const targetTable = target._resolvedTableName || this._resolveTableName(target);

    const fkCol = fkAttr;
    const otherKeyCol = otherKeyAttr;

    const columns = {
      [fkAttr]: {type: sourcePKType, primaryKey: false, autoIncrement: false, allowNull: false, field: fkCol},
      [otherKeyAttr]: {type: targetPKType, primaryKey: false, autoIncrement: false, allowNull: false, field: otherKeyCol}
    };

    const uniqueConstraints = [{columns: [fkCol, otherKeyCol], constraintName: `uk_${through}_${fkCol}_${otherKeyCol}`}];

    const foreignKeys = [
      {
        attributeName: fkAttr,
        columnName: fkCol,
        constraintName: `fk_${through}_${fkCol}`,
        references: { model: source.modelName, table: sourceTable, key: sourcePKAttr, column: sourcePKCol },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      {
        attributeName: otherKeyAttr,
        columnName: otherKeyCol,
        constraintName: `fk_${through}_${otherKeyCol}`,
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

  /**
   * Collects unique junction tables from all belongsToMany associations.
   * @returns {import('./Association.js').Association[]}
   * @private
   */
  _buildJunctionTables() {
    const junctions = [];
    const seen = new Set();
    for (const modelClass of this._registry.all()) {
      for (const assoc of Object.values(modelClass.associations || {})) {
        if (assoc.type !== 'belongsToMany') continue;
        if (assoc.throughModel) continue;
        const through = this._getAssociationThroughTable(assoc);
        if (seen.has(through)) continue;
        seen.add(through);
        junctions.push(assoc);
      }
    }
    return junctions;
  }

  _getAssociationThroughTable(assoc) {
    return assoc.throughModel?._resolvedTableName
      || assoc.throughModel?.tableName
      || assoc.throughTable
      || assoc.through;
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
      if (modelClass._isVirtualAttribute?.(def)) continue;
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
   * Normalizes logging configuration into per-level handlers.
   * @param {boolean|function|object|undefined} logging
   * @returns {{info: Function|false, trace: Function|false, warning: Function|false, error: Function|false}}
   * @private
   */
  _normalizeLogging(logging) {
    const disabled = { info: false, trace: false, warning: false, error: false };
    const defaults = {info: console.log.bind(console), trace: false, warning: false, error: console.error.bind(console)};
    if (logging === undefined || logging === true) return { ...defaults };
    if (logging === false || logging === null) return disabled;
    if (typeof logging === 'function') return { ...defaults, info: logging };
    if (typeof logging === 'object') {
      return {...defaults, ...logging, warning: logging.warning ?? logging.warn ?? defaults.warning, trace: logging.trace ?? defaults.trace};
    }
    return disabled;
  }

  _formatLogValue(value) {
    if (value === null || typeof value !== 'object') return value;
    let output;
    try {
      output = JSON.stringify(value);
    } catch {
      output = String(value);
    }
    return output.replace(/["']/g, '');
  }

  /**
   * Logs a message if the selected level is enabled.
   * @param {string} [level]
   * @param {...*} args
   * @private
   */
  _log(...args) {
    const levels = new Set(['info', 'trace', 'warning', 'error']);
    let level = 'info';
    let payload = args;
    if (args.length > 1 && levels.has(args[0])) [level, ...payload] = args;
    const logger = this._logging?.[level];
    //if (typeof logger === 'function')  logger('[Seq]', ...payload.map(value => this._formatLogValue(value)));
    if (typeof logger === 'function')  logger('Seq', ...payload);
  }
}
