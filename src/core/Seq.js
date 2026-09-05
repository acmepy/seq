import { ModelRegistry } from './ModelRegistry.js';
import { Model } from './Model.js';
import { ConfigurationError } from './errors/ConfigurationError.js';
import { Cache } from '../cache/Cache.js';

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
    this._slowQueryMs = this._normalizeSlowThreshold(options.slowQueryMs, 'slowQueryMs');
    this._slowOperationMs = this._normalizeSlowThreshold(options.slowOperationMs, 'slowOperationMs');
    this._define = options.define || {};
    this._registry = new ModelRegistry();
    this._initialized = false;
    this._modelClasses = options.models || [];
    this.cache = options.cache ? new Cache(options.cache) : null;
    if (this.cache) this.cache.seq = this;
  }

  /**
   * Returns the active adapter.
   * @returns {import('../adapters/BaseAdapter.js').BaseAdapter}
   */
  get adapter() {
    return this._adapter;
  }

  _normalizeSlowThreshold(value, name) {
    if (value === undefined) return 1000;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ConfigurationError(`${name} must be a non-negative finite number`, { code: 'SEQ_INVALID_SLOW_THRESHOLD' });
    }
    return value;
  }

  _isSlowQuery(durationMs) {
    return durationMs >= this._slowQueryMs;
  }

  _isSlowOperation(durationMs) {
    return durationMs >= this._slowOperationMs;
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
    for (const modelClass of this._modelClasses) modelClass._resolvedTableName = this._resolveTableName(modelClass);

    // Phase 2: Register models (now that modelName is set)
    for (const modelClass of this._modelClasses) this.registerModel(modelClass);
    this._runModelAssociations();
    await this._registerExistingSchemas();
    this._initialized = true;
    this._log('info', 'Seq initialized');
  }

  /**
   * Registers a model class.
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   */
  registerModel(modelClass) {
    if (!modelClass._resolvedTableName) modelClass._resolvedTableName = this._resolveTableName(modelClass);
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
      if (model._resolvedTableName && !result[model._resolvedTableName]) result[model._resolvedTableName] = model;
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

  async _registerExistingSchemas() {
    if (typeof this._adapter.ddl?.listTables !== 'function') return;

    let existingTables;
    try {
      existingTables = await this._adapter.ddl.listTables();
    } catch (error) {
      if (error?.code === 'SEQ_DDL_NOT_IMPLEMENTED') return;
      throw error;
    }

    const existing = new Set(existingTables);
    const definitions = [
      ...this._registry.all().map(modelClass => this._buildTableDefinition(modelClass)),
      ...this._buildJunctionTables().map(assoc => this._buildJunctionTableDefinition(assoc))
    ];

    for (const definition of definitions) {
      if (!existing.has(definition.tableName) || this._adapter.schemas.has(definition.tableName)) continue;
      const def = typeof this._adapter.ddl.introspectDefinition === 'function'
        ? await this._adapter.ddl.introspectDefinition(definition)
        : this._adapter.ddl.normalizeDefinition(definition);
      this._adapter.ddl._registerSchema(def, { preserveConstraints: true });
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
    let tableName = null;
    try {
      return await this._sync(options, (name) => { tableName = name; });
    } catch (error) {
      this._log('error', 'Sync failed', {
        operation: 'sync',
        tableName,
        force: options.force === true,
        alter: options.alter === true,
        error: serializeError(error)
      });
      throw error;
    }
  }

  async _sync(options, setTableName) {
    const { force = false, alter = false } = options;
    const result = { created: [], existing: [], altered: [], dropped: [] };
    const existingTables = new Set(await this._adapter.ddl.listTables());
    const definitions = [
      ...this._registry.all().map(modelClass => this._buildTableDefinition(modelClass)),
      ...this._buildJunctionTables().map(assoc => this._buildJunctionTableDefinition(assoc))
    ];
    const uniqueDefinitions = [...new Map(definitions.map(definition => [definition.tableName, definition])).values()];
    const orderedDefinitions = this._orderTableDefinitions(uniqueDefinitions);

    if (force) {
      for (const definition of [...orderedDefinitions].reverse()) {
        if (!existingTables.has(definition.tableName)) continue;
        setTableName(definition.tableName);
        await this._adapter.ddl.dropTable(definition.tableName);
        result.dropped.push(definition.tableName);
      }
      for (const definition of orderedDefinitions) {
        setTableName(definition.tableName);
        await this._adapter.ddl.createTable(definition);
        result.created.push(definition.tableName);
      }
      this._log('info', 'Sync complete');
      return result;
    }

    for (const definition of orderedDefinitions) {
      const tableName = definition.tableName;
      setTableName(tableName);

      if (existingTables.has(tableName)) {
        if (alter) {
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

    this._log('info', 'Sync complete');
    return result;
  }

  _orderTableDefinitions(definitions) {
    const byName = new Map(definitions.map(definition => [definition.tableName, definition]));
    const visited = new Set();
    const visiting = new Set();
    const ordered = [];
    const visit = definition => {
      if (visited.has(definition.tableName)) return;
      if (visiting.has(definition.tableName)) return;
      visiting.add(definition.tableName);
      for (const fk of definition.foreignKeys || []) {
        const dependency = byName.get(fk.references.table);
        if (dependency) visit(dependency);
      }
      visiting.delete(definition.tableName);
      visited.add(definition.tableName);
      ordered.push(definition);
    };
    for (const definition of definitions) visit(definition);
    return ordered;
  }

  /**
   * Executes a transactional callback.
   * @template TResult
   * @param {function(*): Promise<TResult>|TResult} callback - Function receiving a transaction object.
   * @returns {Promise<TResult>}
   */
  async transaction(callback) {
    const transaction = await this._adapter.tcl.begin();
    if (!transaction.afterCommitCallbacks) {
      transaction.afterCommitCallbacks = [];
      transaction.afterCommit = (cb) => transaction.afterCommitCallbacks.push(cb);
    }
    try {
      const result = await callback(transaction);
      await this._adapter.tcl.commit(transaction);
      for (const cb of transaction.afterCommitCallbacks) {
        await cb();
      }
      return result;
    } catch (error) {
      try {
        await this._adapter.tcl.rollback(transaction);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
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
   * Applies naming convention, prefix, and configured case style.
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   * @returns {string}
   * @private
   */
  _resolveTableName(modelClass) {
    return this._adapter.resolveTableName(modelClass);
  }

  /**
   * Resolves the effective column name for an attribute.
   * Applies naming convention and configured case style.
   * @param {object} def - Attribute definition
   * @param {string} attrName - Attribute name
   * @returns {string}
   * @private
   */
  _resolveColumnName(def, attrName) {
    return this._adapter.resolveColumnName(def, attrName);
  }

  /**
   * Builds a table definition from a model class for DDL operations.
   * @param {import('../../types/index.d.ts').ModelStatic} modelClass
   * @returns {object}
   * @private
   */
  _buildTableDefinition(modelClass) {
    return this._adapter.buildTableDefinition(modelClass, this._adapterDefinitionContext());
  }

  /**
   * Builds a table definition for a belongsToMany junction/pivot table.
   * @param {import('./Association.js').Association} assoc
   * @returns {object}
   * @private
   */
  _buildJunctionTableDefinition(assoc) {
    return this._adapter.buildJunctionTableDefinition(assoc, this._adapterDefinitionContext());
  }

  /**
   * Collects unique junction tables from all belongsToMany associations.
   * @returns {import('./Association.js').Association[]}
   * @private
   */
  _buildJunctionTables() {
    return this._adapter.buildJunctionTables(this._registry.all(), this._adapterDefinitionContext());
  }

  _getAssociationThroughTable(assoc) {
    return this._adapter.getAssociationThroughTable(assoc, this._adapterDefinitionContext());
  }

  _buildForeignKeys(modelClass, attrToColumn) {
    return this._adapter.buildForeignKeys(modelClass, attrToColumn, this._adapterDefinitionContext());
  }

  _constraintTableName(tableName) {
    return this._adapter._constraintTableName(tableName);
  }

  _adapterDefinitionContext() {
    return {
      models: this._registry.all(),
      getModel: name => this.getModel(name)
    };
  }

  /**
   * Normalizes logging configuration into per-level handlers.
   * @param {boolean|function|object|undefined} logging
   * @returns {{info: Function|false, trace: Function|false, warn: Function|false, error: Function|false}}
   * @private
   */
  _normalizeLogging(logging) {
    const disabled = { info: false, trace: false, warn: false, error: false };
    const defaults = {
      info: console.log.bind(console),
      trace: console.log.bind(console),
      warn: console.log.bind(console),
      error: console.error.bind(console)
    };
    if (logging === undefined || logging === true) return { ...defaults };
    if (logging === false || logging === null) return disabled;
    if (typeof logging === 'object') {
      return Object.fromEntries(
        Object.entries(defaults).map(([level, defaultHandler]) => {
          const handler = logging[level] ?? defaultHandler;
          const consoleHandler = Object.values(console).includes(handler);
          return [level, typeof handler === 'function' ? handler.bind(consoleHandler ? console : logging) : handler];
        })
      );
    }
    return disabled;
  }

  _formatLogValue(value) {
    if (value === null || typeof value !== 'object') return value;
    let output;
    try {
      output = JSON.stringify(value, (key, nestedValue) =>
        /password|passwd|token|secret|api[_-]?key/i.test(key) ? '[REDACTED]' : nestedValue
      );
    } catch {
      output = String(value);
    }
    return output;
  }

  /**
   * Logs a message if the selected level is enabled.
   * @param {string} [level]
   * @param {...*} args
   * @private
   */
  _log(...args) {
    const levels = new Set(['info', 'trace', 'warn', 'error']);
    let level = 'info';
    let payload = args;
    if (args.length > 1 && levels.has(args[0])) [level, ...payload] = args;
    const logger = this._logging?.[level];
    const target = typeof logger === 'function' ? this._logging : undefined;
    if (typeof logger === 'function') logger.call(target, '[Seq]', ...payload.map(value => this._formatLogValue(value)));
  }
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    code: error?.code ?? null,
    details: error?.details ?? null
  };
}
