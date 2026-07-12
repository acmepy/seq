import { ModelRegistry } from './ModelRegistry.js';
import { ConfigurationError } from './errors/ConfigurationError.js';

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
      const tableName = modelClass.tableName;

      if (existingTables.includes(tableName)) {
        if (force) {
          await this._adapter.ddl.dropTable(tableName);
          await this._adapter.ddl.createTable(this._buildTableDefinition(modelClass));
          result.dropped.push(tableName);
          result.created.push(tableName);
        } else if (alter) {
          const altered = await this._adapter.ddl.alterTable(
            tableName,
            this._buildTableDefinition(modelClass)
          );
          if (altered) {
            result.altered.push(tableName);
          } else {
            result.existing.push(tableName);
          }
        } else {
          result.existing.push(tableName);
        }
      } else {
        await this._adapter.ddl.createTable(this._buildTableDefinition(modelClass));
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
   * Builds a table definition from a model class for DDL operations.
   * @param {typeof import('./Model.js').Model} modelClass
   * @returns {object}
   * @private
   */
  _buildTableDefinition(modelClass) {
    const attributes = modelClass.rawAttributes || {};
    const columns = {};

    for (const [name, def] of Object.entries(attributes)) {
      columns[name] = {
        type: def.type,
        primaryKey: def.primaryKey || false,
        autoIncrement: def.autoIncrement || false,
        allowNull: def.allowNull !== undefined ? def.allowNull : true,
        defaultValue: def.defaultValue,
        unique: def.unique || false,
        field: def.field || name
      };
    }

    return {
      modelName: modelClass.modelName,
      tableName: modelClass.tableName,
      columns,
      primaryKey: modelClass.primaryKeyAttribute,
      autoIncrement: modelClass.autoIncrementAttribute,
      timestamps: modelClass.options?.timestamps || false,
      createdAt: modelClass.options?.createdAt || 'createdAt',
      updatedAt: modelClass.options?.updatedAt || 'updatedAt'
    };
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
