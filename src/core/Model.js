import { clone } from '../utils/clone.js';
import { Association } from './Association.js';
import { ModelError } from './errors/ModelError.js';
import { ValidationError, ValidationWhereError, ValidationOrderError, ValidationLimitError, ValidationOffsetError } from './errors/ValidationError.js';
import { DataTypes } from '../data-types/index.js';
import { normalizeInclude } from '../utils/include.js';

/**
 * Base Model class. All user-defined models must extend this.
 * Provides static methods for CRUD operations and instance methods for record manipulation.
 */
export class Model {
  /**
   * Creates a new Model instance representing a record.
   * @param {object} values - The record values
   * @param {object} [options] - Creation options
   */
  constructor(values = {}, options = {}) {
    this._options = options;
    this.dataValues = {};
    this._changed = {};
    this._isNew = options._isNew !== undefined ? options._isNew : true;

    const Ctor = this.constructor;
    const attrs = Ctor.rawAttributes || {};

    if (options._partial) {
      for (const [key, value] of Object.entries(values)) {
        this.dataValues[key] = value;
      }
      return;
    }

    for (const key of Object.keys(attrs)) {
      if (key in values) {
        this.dataValues[key] = values[key];
      } else if (attrs[key].defaultValue !== undefined) {
        const dv = attrs[key].defaultValue;
        this.dataValues[key] = typeof dv === 'function' ? dv() : dv;
      } else {
        this.dataValues[key] = null;
      }
    }

    // Include any extra values not in attributes (e.g. timestamps added externally)
    for (const key of Object.keys(values)) {
      if (!(key in this.dataValues)) this.dataValues[key] = values[key];
    }
  }

  /**
   * Initializes the model with attributes and options.
   * @param {object} attributes - Attribute definitions
   * @param {object} options - Model options (seq, modelName, tableName, timestamps, etc.)
   * @returns {typeof Model}
   */
  static init(attributes, options = {}) {
    if (!attributes || typeof attributes !== 'object') throw new Error('Model.init requires an attributes object');

    this.rawAttributes = {};
    this.primaryKeyAttribute = null;
    this.autoIncrementAttribute = null;

    for (const [name, def] of Object.entries(attributes)) {
      if (!def.type) throw new Error(`Attribute "${name}" must have a type`);
      this.rawAttributes[name] = { ...def, type: this._normalizeDataType(def.type) };
      if (def.primaryKey) {
        if (this.primaryKeyAttribute) throw new Error('Model must not have more than one primaryKey attribute');
        this.primaryKeyAttribute = name;
      }
      if (def.autoIncrement) {
        if (this.autoIncrementAttribute) {
          throw new Error('Model must not have more than one autoIncrement attribute');
        }
        this.autoIncrementAttribute = name;
      }
    }

    // Timestamps
    const timestamps = options.timestamps !== undefined ? options.timestamps : true;
    this.options = { ...options, timestamps };

    if (timestamps) {
      const createdAtField = options.createdAt || 'createdAt';
      const updatedAtField = options.updatedAt || 'updatedAt';

      if (!this.rawAttributes[createdAtField]) {
        this.rawAttributes[createdAtField] = {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: () => new Date()
        };
      }
      if (!this.rawAttributes[updatedAtField]) {
        this.rawAttributes[updatedAtField] = {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: () => new Date()
        };
      }
    }

    this.modelName = options.modelName || this.name;
    this.tableName = options.tableName || this.modelName;
    this._tableNameExplicit = options.tableName !== undefined;
    this.seq = options.seq || null;
    this.associations = this.associations || {};
    this._hooks = {};
    for (const [hookName, handlers] of Object.entries(options.hooks || {})) {
      this._hooks[hookName] = Array.isArray(handlers) ? [...handlers] : [handlers];
    }

    this.alias = options.alias || this.modelName.split(/(?=[A-Z])/).map(w => w[0].toLowerCase()).join('');

    return this;
  }

  static _normalizeDataType(type) {
    if (typeof type === 'function' && type._defaultType) return type._defaultType();
    return type;
  }

  /**
   * Hook for automatic initialization when registered with Seq.
   * Override in subclasses.
   * @param {import('./Seq.js').Seq} seq
   */
  static define(seq) {}

  static _defaultForeignKeyName(referencedModelName, pkAttr) {
    const ref = referencedModelName;
    const pk = pkAttr.charAt(0).toUpperCase() + pkAttr.slice(1);
    return ref.charAt(0).toLowerCase() + ref.slice(1) + pk;
  }

  static hasMany(target, options = {}) {
    if (!target) throw new ModelError('hasMany requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, target.primaryKeyAttribute || 'id');
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) {
      throw new ModelError(`Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasMany association`, { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } });
    }
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase() + 's';
    const assoc = new Association('hasMany', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static hasOne(target, options = {}) {
    if (!target) throw new ModelError('hasOne requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, target.primaryKeyAttribute || 'id');
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) throw new ModelError(`Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasOne association`, { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } });
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase();
    const assoc = new Association('hasOne', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static belongsTo(target, options = {}) {
    if (!target) throw new ModelError('belongsTo requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    if (this.rawAttributes && !this.rawAttributes[fkAttr]) throw new ModelError(`Model "${this.modelName}" must have a "${fkAttr}" attribute for belongsTo association`,{ code: 'SEQ_ASSOCIATION_MISSING_FK', details: { source: this.modelName, foreignKey: fkAttr } });
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase();
    const assoc = new Association('belongsTo', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static belongsToMany(target, options = {}) {
    if (!target) throw new ModelError('belongsToMany requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    if (!options.through) throw new ModelError('belongsToMany requires a "through" option', { code: 'SEQ_ASSOCIATION_MISSING_THROUGH' });

    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, this.primaryKeyAttribute || 'id');
    const otherKey = options.otherKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase() + 's';
    const assoc = new Association('belongsToMany', this, target, { ...options, foreignKey: fkAttr, otherKey });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  /**
   * Returns the Seq instance associated with this model.
   * @returns {import('./Seq.js').Seq}
   */
  static get _seq() {
    return this.seq;
  }

  /**
   * Returns the adapter associated with this model.
   */
  static get _adapter() {
    return this.seq?.adapter;
  }

  /**
   * Logs a message if logging is enabled on the Seq instance.
   * @param {...*} args
   */
  static _log(...args) {
    this.seq?._log(...args);
  }

  /**
   * Registers a model hook.
   * @param {string} name
   * @param {function} handler
   * @returns {typeof Model}
   */
  static addHook(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Hook "${name}" must be a function`);
    }
    if (!this._hooks) this._hooks = {};
    if (!this._hooks[name]) this._hooks[name] = [];
    this._hooks[name].push(handler);
    return this;
  }

  /**
   * Runs registered hooks sequentially.
   * @param {string} name
   * @param {...*} args
   * @returns {Promise<void>}
   */
  static async _runHooks(name, ...args) {
    const hooks = this._hooks?.[name] || [];
    for (const hook of hooks) {
      await hook.apply(this, args);
    }
  }

  /**
   * Creates a new record.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model>}
   */
  static async create(values = {}, options = {}) {
    this._log('trace', `${this.modelName}.create`, values);
    if (options.hooks !== false) await this._runHooks('beforeCreate', values, options);
    const result = await this._adapter.dml.insert(this, values, options);
    if (options.hooks !== false) await this._runHooks('afterCreate', result, options);
    return result;
  }

  /**
   * Creates multiple records.
   * @param {object[]} records
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async bulkCreate(records = [], options = {}) {
    this._log('trace', `${this.modelName}.bulkCreate`, records);
    if (options.hooks !== false) await this._runHooks('beforeBulkCreate', records, options);
    const result = await this._adapter.dml.bulkInsert(this, records, options);
    if (options.hooks !== false) await this._runHooks('afterBulkCreate', result, options);
    return result;
  }

  /**
   * Finds a record by primary key.
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<Model|null>}
   */
  static async findByPk(id, options = {}) {
    this._log('trace', `${this.modelName}.findByPk`, id);
    if (!this.primaryKeyAttribute) throw new Error(`Model "${this.modelName}" has no primary key`);
    const where = { [this.primaryKeyAttribute]: id };
    return this.findOne({ ...options, where });
  }

  /**
   * Finds one record matching the options.
   * @param {object} [options]
   * @returns {Promise<Model|null>}
   */
  static async findOne(options = {}) {
    this._log('trace', `${this.modelName}.findOne`, options);
    if (options.hooks !== false) await this._runHooks('beforeFind', options);
    const result = await this._adapter.dml.selectOne(this, options);
    if (options.hooks !== false) await this._runHooks('afterFind', result, options);
    return result;
  }

  /**
   * Finds all records matching the options.
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async findAll(options = {}) {
    if (options.hooks !== false) await this._runHooks('beforeFind', options);
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where))) throw new ValidationWhereError();
    if (options.order !== undefined && !Array.isArray(options.order)) throw new ValidationOrderError();
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1))  throw new ValidationLimitError();
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) throw new ValidationOffsetError();
    if (options.include) options.include = normalizeInclude(options.include);
    this._log('trace', `${this.modelName}.findAll`, options);
    const result = await this._adapter.dml.selectAll(this, options);
    if (options.hooks !== false) await this._runHooks('afterFind', result, options);
    return result;
  }

  /**
   * Counts records matching the options.
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  static async count(options = {}) {
    if (options.hooks !== false) await this._runHooks('beforeCount', options);
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where))) throw new ValidationWhereError();
    this._log('trace', `${this.modelName}.count`, options);
    const result = await this._adapter.dml.count(this, options);
    if (options.hooks !== false) await this._runHooks('afterCount', result, options);
    return result;
  }

  /**
   * Updates records matching the where clause.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async update(values, options = {}) {
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where)))throw new ValidationWhereError();
    this._log('trace', `${this.modelName}.update`, values, options);
    if (options.hooks !== false) await this._runHooks('beforeUpdate', values, options);
    const result = await this._adapter.dml.update(this, values, options);
    if (options.hooks !== false) await this._runHooks('afterUpdate', result, options);
    return result;
  }

  /**
   * Destroys records matching the where clause.
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  static async destroy(options = {}) {
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where)))throw new ValidationWhereError();
    this._log('trace', `${this.modelName}.destroy`, options);
    if (options.hooks !== false) await this._runHooks('beforeDestroy', options);
    const result = await this._adapter.dml.delete(this, options);
    if (options.hooks !== false) await this._runHooks('afterDestroy', result, options);
    return result;
  }

  /**
   * Truncates all records in the table.
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  static async truncate(options = {}) {
    this._log('trace', `${this.modelName}.truncate`);
    if (options.hooks !== false) await this._runHooks('beforeTruncate', options);
    const result = await this._adapter.dml.truncate(this, options);
    if (options.hooks !== false) await this._runHooks('afterTruncate', options);
    return result;
  }

  /**
   * Builds a new instance without persisting it.
   * @param {object} values
   * @param {object} [options]
   * @returns {Model}
   */
  static build(values = {}, options = {}) {
    return new this(values, options);
  }

  /**
   * Returns the value of a data field.
   * @param {string} key
   * @returns {*}
   */
  getDataValue(key) {
    return this.dataValues[key];
  }

  /**
   * Sets the value of a data field.
   * @param {string} key
   * @param {*} value
   */
  setDataValue(key, value) {
    this.dataValues[key] = value;
    this._changed[key] = true;
  }

  /**
   * Returns a plain object with all data values.
   * @returns {object}
   */
  get() {
    return clone(this.dataValues);
  }

  /**
   * Returns a JSON-safe plain object.
   * @returns {object}
   */
  toJSON() {
    return this.get();
  }

  /**
   * Saves the instance (create or update).
   * @param {object} [options]
   * @returns {Promise<Model>}
   */
  async save(options = {}) {
    const Ctor = this.constructor;
    const isNew = this._isNew;
    if (options.hooks !== false) {
      await Ctor._runHooks('beforeSave', this, options);
      await Ctor._runHooks(isNew ? 'beforeCreate' : 'beforeUpdate', this, options);
    }

    if (this._isNew) {
      const result = await Ctor._adapter.dml.insert(
        Ctor,
        this.dataValues,
        options
      );
      Object.assign(this.dataValues, result.dataValues);
      this._isNew = false;
      this._changed = {};
      if (options.hooks !== false) {
        await Ctor._runHooks('afterCreate', this, options);
        await Ctor._runHooks('afterSave', this, options);
      }
      return this;
    }
    const pk = Ctor.primaryKeyAttribute;
    const where = { [pk]: this.dataValues[pk] };
    const result = await Ctor._adapter.dml.update(
      Ctor,
      this.dataValues,
      { ...options, where }
    );
    if (result && result.length > 0) {
      Object.assign(this.dataValues, result[0].dataValues);
    }
    this._changed = {};
    if (options.hooks !== false) {
      await Ctor._runHooks('afterUpdate', this, options);
      await Ctor._runHooks('afterSave', this, options);
    }
    return this;
  }

  /**
   * Updates values and saves the instance.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model>}
   */
  async update(values, options = {}) {
    for (const [key, value] of Object.entries(values)) this.setDataValue(key, value);
    this._isNew = false;
    return this.save(options);
  }

  /**
   * Destroys this record.
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async destroy(options = {}) {
    const Ctor = this.constructor;
    if (options.hooks !== false) await Ctor._runHooks('beforeDestroy', this, options);
    const pk = Ctor.primaryKeyAttribute;
    const where = { [pk]: this.dataValues[pk] };
    await Ctor.destroy({ ...options, where, hooks: false });
    if (options.hooks !== false) await Ctor._runHooks('afterDestroy', this, options);
  }
}
