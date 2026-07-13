import { clone } from '../utils/clone.js';
import { Association } from './Association.js';
import { ModelError } from './errors/ModelError.js';

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
      if (!(key in this.dataValues)) {
        this.dataValues[key] = values[key];
      }
    }
  }

  /**
   * Initializes the model with attributes and options.
   * @param {object} attributes - Attribute definitions
   * @param {object} options - Model options (seq, modelName, tableName, timestamps, etc.)
   * @returns {typeof Model}
   */
  static init(attributes, options = {}) {
    if (!attributes || typeof attributes !== 'object') {
      throw new Error('Model.init requires an attributes object');
    }

    this.rawAttributes = {};
    this.primaryKeyAttribute = null;
    this.autoIncrementAttribute = null;

    for (const [name, def] of Object.entries(attributes)) {
      if (!def.type) {
        throw new Error(`Attribute "${name}" must have a type`);
      }
      this.rawAttributes[name] = { ...def };
      if (def.primaryKey) {
        if (this.primaryKeyAttribute) {
          throw new Error('Model must not have more than one primaryKey attribute');
        }
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
          type: { key: 'DATE' },
          allowNull: true,
          defaultValue: () => new Date()
        };
      }
      if (!this.rawAttributes[updatedAtField]) {
        this.rawAttributes[updatedAtField] = {
          type: { key: 'DATE' },
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

    return this;
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
    if (!target) {
      throw new ModelError('hasMany requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    }
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, target.primaryKeyAttribute || 'id');
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) {
      throw new ModelError(
        `Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasMany association`,
        { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } }
      );
    }
    if (!this.associations) this.associations = {};
    const assoc = new Association('hasMany', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static hasOne(target, options = {}) {
    if (!target) {
      throw new ModelError('hasOne requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    }
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, target.primaryKeyAttribute || 'id');
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) {
      throw new ModelError(
        `Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasOne association`,
        { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } }
      );
    }
    if (!this.associations) this.associations = {};
    const assoc = new Association('hasOne', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static belongsTo(target, options = {}) {
    if (!target) {
      throw new ModelError('belongsTo requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    }
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    if (this.rawAttributes && !this.rawAttributes[fkAttr]) {
      throw new ModelError(
        `Model "${this.modelName}" must have a "${fkAttr}" attribute for belongsTo association`,
        { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { source: this.modelName, foreignKey: fkAttr } }
      );
    }
    if (!this.associations) this.associations = {};
    const assoc = new Association('belongsTo', this, target, { ...options, foreignKey: fkAttr });
    this.associations[target.modelName || target.name || 'unknown'] = assoc;
    return this;
  }

  static belongsToMany(target, options = {}) {
    if (!target) {
      throw new ModelError('belongsToMany requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    }
    if (!options.through) {
      throw new ModelError('belongsToMany requires a "through" option', { code: 'SEQ_ASSOCIATION_MISSING_THROUGH' });
    }
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, this.primaryKeyAttribute || 'id');
    const otherKey = options.otherKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    if (!this.associations) this.associations = {};
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
   * Creates a new record.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model>}
   */
  static async create(values = {}, options = {}) {
    const instance = this.build(values, { _isNew: true });
    return instance.save(options);
  }

  /**
   * Creates multiple records.
   * @param {object[]} records
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async bulkCreate(records = [], options = {}) {
    const results = [];
    for (const record of records) {
      results.push(await this.create(record, options));
    }
    return results;
  }

  /**
   * Finds a record by primary key.
   * @param {*} id
   * @param {object} [options]
   * @returns {Promise<Model|null>}
   */
  static async findByPk(id, options = {}) {
    if (!this.primaryKeyAttribute) {
      throw new Error(`Model "${this.modelName}" has no primary key`);
    }
    const where = { [this.primaryKeyAttribute]: id };
    return this.findOne({ ...options, where });
  }

  /**
   * Finds one record matching the options.
   * @param {object} [options]
   * @returns {Promise<Model|null>}
   */
  static async findOne(options = {}) {
    return this._adapter.dml.selectOne(this, options);
  }

  /**
   * Finds all records matching the options.
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async findAll(options = {}) {
    return this._adapter.dml.selectAll(this, options);
  }

  /**
   * Counts records matching the options.
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  static async count(options = {}) {
    return this._adapter.dml.count(this, options);
  }

  /**
   * Updates records matching the where clause.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model[]>}
   */
  static async update(values, options = {}) {
    return this._adapter.dml.update(this, values, options);
  }

  /**
   * Destroys records matching the where clause.
   * @param {object} [options]
   * @returns {Promise<number>}
   */
  static async destroy(options = {}) {
    return this._adapter.dml.delete(this, options);
  }

  /**
   * Truncates all records in the table.
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  static async truncate(options = {}) {
    return this._adapter.dml.truncate(this, options);
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
    if (this._isNew) {
      const result = await this.constructor._adapter.dml.insert(
        this.constructor,
        this.dataValues,
        options
      );
      Object.assign(this.dataValues, result.dataValues);
      this._isNew = false;
      this._changed = {};
      return this;
    }
    const pk = this.constructor.primaryKeyAttribute;
    const where = { [pk]: this.dataValues[pk] };
    const result = await this.constructor._adapter.dml.update(
      this.constructor,
      this.dataValues,
      { ...options, where }
    );
    if (result && result.length > 0) {
      Object.assign(this.dataValues, result[0].dataValues);
    }
    this._changed = {};
    return this;
  }

  /**
   * Updates values and saves the instance.
   * @param {object} values
   * @param {object} [options]
   * @returns {Promise<Model>}
   */
  async update(values, options = {}) {
    for (const [key, value] of Object.entries(values)) {
      this.setDataValue(key, value);
    }
    this._isNew = false;
    return this.save(options);
  }

  /**
   * Destroys this record.
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async destroy(options = {}) {
    const pk = this.constructor.primaryKeyAttribute;
    const where = { [pk]: this.dataValues[pk] };
    await this.constructor.destroy({ ...options, where });
  }
}
