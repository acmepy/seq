import crypto from 'crypto';
import util from 'node:util';

/**
 * Base error class for all Seq ORM errors.
 */
class SeqError extends Error {
  /**
   * @param {string} message - Error message
 * @param {object} [options] - Error options
 * @param {number} [options.status] - HTTP-compatible status for integrations
 * @param {string} [options.code] - Error code
 * @param {*} [options.errors] - Field-level normalized errors
 * @param {*} [options.details] - Additional error details
 * @param {*} [options.cause] - Original cause
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SeqError';
    this.status = options.status || null;
    this.code = options.code || 'SEQ_ERROR';
    this.errors = options.errors || null;
    this.details = options.details || null;
  }
}

/**
 * Error thrown for model-related issues in Seq ORM.
 */
class ModelError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ModelError';
    this.code = options.code || 'SEQ_MODEL_ERROR';
  }
}

/**
 * Central registry for models in a Seq instance.
 */
class ModelRegistry {
  constructor() {
    /** @type {Map<string, typeof import('./Model.js').Model>} */
    this._models = new Map();
    /** @type {Map<string, string>} */
    this._tableNames = new Map();
  }

  /**
   * Registers a model class.
   * @param {typeof import('./Model.js').Model} modelClass
   */
  register(modelClass) {
    const name = modelClass.modelName;
    if (!name) {
      throw new ModelError('Model must have a modelName', {
        code: 'SEQ_MODEL_MISSING_NAME'
      });
    }
    if (this._models.has(name)) {
      throw new ModelError(`Model "${name}" is already registered`, {
        code: 'SEQ_MODEL_DUPLICATE',
        details: { modelName: name }
      });
    }
    this._models.set(name, modelClass);
    const tableName = modelClass._resolvedTableName || modelClass.tableName;
    if (tableName) {
      if (this._tableNames.has(tableName)) {
        throw new ModelError(
          `Table name "${tableName}" is already used by model "${this._tableNames.get(tableName)}"`,
          { code: 'SEQ_MODEL_DUPLICATE_TABLE' }
        );
      }
      this._tableNames.set(tableName, name);
    }
  }

  /**
   * Gets a model by name.
   * @param {string} name
   * @returns {typeof import('./Model.js').Model|undefined}
   */
  get(name) {
    return this._models.get(name);
  }

  /**
   * Checks if a model is registered.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._models.has(name);
  }

  /**
   * Returns all registered models.
   * @returns {typeof import('./Model.js').Model[]}
   */
  all() {
    return [...this._models.values()];
  }

  /**
   * Clears all registered models.
   */
  clear() {
    this._models.clear();
    this._tableNames.clear();
  }
}

/**
 * Creates a deep clone of a value while preserving model instances.
 * @param {*} value - The value to clone
 * @returns {*} A deep clone of the value
 */
function clone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(item => clone(item));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) {
      return value;
    }
    const cloned = {};
    for (const [key, child] of Object.entries(value)) {
      cloned[key] = clone(child);
    }
    return cloned;
  }
  return value;
}

class Association {
  /**
   * @param {'hasMany'|'hasOne'|'belongsTo'|'belongsToMany'} type
   * @param {import('../../types/index.d.ts').ModelStatic} source
   * @param {import('../../types/index.d.ts').ModelStatic} target
   * @param {import('../../types/index.d.ts').AssociationOptions} options
   */
  constructor(type, source, target, options = {}) {
    const validActions = new Set(['RESTRICT', 'CASCADE', 'SET NULL']);
    for (const [name, value] of [['onDelete', options.onDelete], ['onUpdate', options.onUpdate]]) {
      if (value !== undefined && !validActions.has(value)) {
        throw new ModelError(`${name} must be RESTRICT, CASCADE or SET NULL`, { code: 'SEQ_ASSOCIATION_INVALID_ACTION' });
      }
    }
    this.type = type;
    this.source = source;
    this.target = target;
    this.foreignKey = options.foreignKey || null;
    this.as = options.as || null;
    this.onDelete = options.onDelete || 'RESTRICT';
    this.onUpdate = options.onUpdate || 'RESTRICT';
    this.through = options.through || null;
    this.throughModel = options.throughModel || null;
    this.throughTable = options.throughTable || options.through || null;
    this.otherKey = options.otherKey || null;
    this.constraintName = options.constraintName || null;
  }
}

/**
 * Error thrown for validation issues in Seq ORM.
 */
class ValidationError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ValidationError';
    this.code = options.code || 'SEQ_VALIDATION_ERROR';
  }
}

class ValidationWhereError extends ValidationError{
  constructor(message, options = {}){
    super('where must be an object', { code: 'SEQ_VALIDATION_WHERE', ...options });
  }
}

class ValidationOrderError extends ValidationError{
  constructor(message, options = {}){
    super('order must be an array', { code: 'SEQ_VALIDATION_ORDER', ...options });
  }
}

class ValidationLimitError extends ValidationError{
  constructor(message, options = {}){
    super('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT', ...options });
  }
}

class ValidationOffsetError extends ValidationError{
  constructor(message, options = {}){
    super('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET', ...options });
  }
}

/**
 * Abstract base class for all Seq data types.
 * Concrete database types should be resolved by adapters.
 */
class AbstractDataType {
  /**
   * @param {string} key - Type identifier
   * @param {object} [options] - Type configuration options
   */
  constructor(key, options = {}) {
    this.key = key;
    this.options = options;
  }

  /**
   * Returns a string representation of this type.
   * @returns {string}
   */
  toString() {
    const opts = Object.values(this.options);
    if (opts.length === 0) return this.key;
    return `${this.key}(${opts.join(', ')})`;
  }

  /**
   * Validates a value against this type.
   * Subclasses must implement this method.
   * @param {*} value - The value to validate
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    return { valid: true, message: '' };
  }
}

/**
 * Represents an integer data type.
 */
class IntegerType extends AbstractDataType {
  constructor() {
    super('INTEGER');
  }

  /**
   * Validates that a value is an integer.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (!Number.isInteger(value)) {
      return { valid: false, message: `Expected an integer, got ${typeof value}` };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a number data type with precision and scale.
 * Alias for DecimalType with different default behavior.
 */
class NumberType extends AbstractDataType {
  /**
   * @param {number} [precision=10] - Total number of digits
   * @param {number} [scale=0] - Number of digits after decimal point
   */
  constructor(precision = 10, scale = 0) {
    super('NUMBER', { precision, scale });
  }

  /**
   * Validates that a value is a valid number.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, message: `Expected a valid number, got ${typeof value}` };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a decimal/numeric data type with precision and scale.
 * Extends NumberType with a different default scale.
 */
class DecimalType extends NumberType {
  /**
   * @param {number} [precision=10] - Total number of digits
   * @param {number} [scale=2] - Number of digits after decimal point
   */
  constructor(precision = 10, scale = 2) {
    super(precision, scale);
    this.key = 'DECIMAL';
  }
}

/**
 * Represents a string/varchar data type with configurable length.
 */
class StringType extends AbstractDataType {
  /**
   * @param {number} [length=255] - Maximum string length
   */
  constructor(length = 255) {
    super('STRING', { length });
  }

  /**
   * Validates that a value is a string within the configured length.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (typeof value !== 'string') {
      return { valid: false, message: `Expected a string, got ${typeof value}` };
    }
    if (value.length > this.options.length) {
      return {
        valid: false,
        message: `String length ${value.length} exceeds maximum ${this.options.length}`
      };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a boolean data type.
 */
class BooleanType extends AbstractDataType {
  constructor() {
    super('BOOLEAN');
  }

  /**
   * Validates that a value is a boolean.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (typeof value !== 'boolean') {
      return { valid: false, message: `Expected a boolean, got ${typeof value}` };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a date data type.
 */
class DateType extends AbstractDataType {
  constructor() {
    super('DATE');
  }

  /**
   * Validates that a value is a Date instance.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (!(value instanceof Date) || isNaN(value.getTime())) {
      return { valid: false, message: `Expected a valid Date instance, got ${typeof value}` };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents an array data type with optional item type validation.
 */
class ArrayType extends AbstractDataType {
  /**
   * @param {AbstractDataType|null} [itemType=null] - Type to validate each element against
   */
  constructor(itemType = null) {
    super('ARRAY', itemType ? { itemType } : {});
    this._itemType = itemType;
  }

  /**
   * Validates that a value is an array, and optionally validates each element.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (!Array.isArray(value)) {
      return { valid: false, message: `Expected an array, got ${typeof value}` };
    }
    if (this._itemType) {
      for (let i = 0; i < value.length; i++) {
        const result = this._itemType.validate(value[i]);
        if (!result.valid) {
          return {
            valid: false,
            message: `Item at index ${i}: ${result.message}`
          };
        }
      }
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a plain object data type.
 * Accepts plain objects; rejects arrays, Dates, null, and other non-plain values.
 */
class ObjectType extends AbstractDataType {
  constructor() {
    super('OBJECT');
  }

  /**
   * Validates that a value is a plain object.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (typeof value !== 'object') {
      return { valid: false, message: `Expected an object, got ${typeof value}` };
    }
    if (Array.isArray(value)) {
      return { valid: false, message: 'Expected an object, got array' };
    }
    if (value instanceof Date) {
      return { valid: false, message: 'Expected an object, got Date' };
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return { valid: false, message: 'Expected a plain object' };
    }
    return { valid: true, message: '' };
  }
}

/**
 * Represents a JSON data type.
 * Extends ObjectType: validates that the value is a plain object
 * and contains only JSON-serializable values (no functions, no undefined, no circular refs).
 */
class JSONType extends ObjectType {
  constructor() {
    super();
    this.key = 'JSON';
  }

  /**
   * Validates that a value is a JSON-serializable plain object.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    const base = super.validate(value);
    if (!base.valid) {
      return base;
    }
    const err = this._checkSerializable(value, '', new WeakSet());
    if (err) {
      return { valid: false, message: err };
    }
    return { valid: true, message: '' };
  }

  /**
   * Recursively checks for non-JSON-serializable values.
   * @param {*} value
   * @param {string} [path='']
   * @returns {string|null} Error message or null if valid
   * @private
   */
  _checkSerializable(value, path = '', seen = new WeakSet()) {
    if (value === null) return null;

    const type = typeof value;

    if (type === 'undefined') {
      return `Value${path ? ' at ' + path : ''} is undefined, which is not JSON-serializable`;
    }
    if (type === 'function') {
      return `Value${path ? ' at ' + path : ''} is a function, which is not JSON-serializable`;
    }
    if (type === 'symbol') {
      return `Value${path ? ' at ' + path : ''} is a symbol, which is not JSON-serializable`;
    }
    if (type === 'bigint') {
      return `Value${path ? ' at ' + path : ''} is a bigint, which is not JSON-serializable`;
    }
    if (type === 'number' && !Number.isFinite(value)) {
      return `Value${path ? ' at ' + path : ''} is not a finite JSON number`;
    }
    if (value instanceof Date) {
      return `Value${path ? ' at ' + path : ''} is a Date, which is not JSON-serializable`;
    }

    if (type === 'object') {
      if (seen.has(value)) return `Value${path ? ' at ' + path : ''} contains a circular reference`;
      seen.add(value);
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const err = this._checkSerializable(value[i], `${path}[${i}]`, seen);
          if (err) return err;
        }
      } else {
        if (Object.getPrototypeOf(value) !== Object.prototype) {
          return `Value${path ? ' at ' + path : ''} is not a plain JSON object`;
        }
        for (const key of Object.keys(value)) {
          const err = this._checkSerializable(value[key], path ? `${path}.${key}` : key, seen);
          if (err) return err;
        }
      }
      seen.delete(value);
    }

    return null;
  }
}

/**
 * Virtual attribute type. It exists only at model-instance level and is never
 * materialized as a database column.
 */
class VirtualType extends AbstractDataType {
  constructor(returnType = null, fields = []) {
    super('VIRTUAL', { returnType, fields });
    this.returnType = returnType;
    this.fields = fields;
  }

  toString() {
    if (!this.returnType) return 'VIRTUAL';
    return `VIRTUAL(${this.returnType})`;
  }

  validate() {
    return { valid: true, message: '' };
  }
}

/**
 * Factory object exposing all available data types.
 * Usage: DataTypes.INTEGER, DataTypes.STRING(100), DataTypes.DECIMAL(12, 2)
 */
const STRING = (length) => new StringType(length);
STRING._defaultType = () => new StringType();

const VIRTUAL = (returnType, fields) => new VirtualType(returnType, fields);
VIRTUAL._defaultType = () => new VirtualType();

const DataTypes = {
  INTEGER: new IntegerType(),
  DECIMAL(precision, scale) {
    return new DecimalType(precision, scale);
  },
  NUMBER(precision, scale) {
    return new NumberType(precision, scale);
  },
  STRING,
  BOOLEAN: new BooleanType(),
  DATE: new DateType(),
  ARRAY(itemType) {
    return new ArrayType(itemType);
  },
  OBJECT: new ObjectType(),
  JSON: new JSONType(),
  VIRTUAL
};

DataTypes._INTEGER = new IntegerType();
DataTypes._BOOLEAN = new BooleanType();
DataTypes._DATE = new DateType();
DataTypes._OBJECT = new ObjectType();
DataTypes._JSON = new JSONType();
DataTypes._VIRTUAL = new VirtualType();

/**
 * Query operators for where clauses.
 * Usage: { [Op.like]: '%ana%' }, { [Op.in]: [1, 2, 3] }
 */
const Op = {
  eq:           Symbol.for('seq.Op.eq'),
  ne:           Symbol.for('seq.Op.ne'),
  gt:           Symbol.for('seq.Op.gt'),
  gte:          Symbol.for('seq.Op.gte'),
  lt:           Symbol.for('seq.Op.lt'),
  lte:          Symbol.for('seq.Op.lte'),
  like:         Symbol.for('seq.Op.like'),
  notLike:      Symbol.for('seq.Op.notLike'),
  in:           Symbol.for('seq.Op.in'),
  notIn:        Symbol.for('seq.Op.notIn'),
  between:      Symbol.for('seq.Op.between'),
  notBetween:   Symbol.for('seq.Op.notBetween'),
  and:          Symbol.for('seq.Op.and'),
  or:           Symbol.for('seq.Op.or'),
};

/**
 * Normalizes the include option to an array of include descriptors.
 * @param {string|typeof import('../core/Model.js').Model|object|Array} include
 * @returns {object[]}
 */
function normalizeInclude(include) {
  const arr = Array.isArray(include) ? include : [include];
  return arr.map(item => {
    if (typeof item === 'function') {
      return { model: item, as: null, attributes: null, where: null, eager: null, include: [] };
    }
    if (typeof item === 'string') {
      return { model: null, as: item, attributes: null, where: null, eager: null, include: [] };
    }
    return {
      model: item.model || null,
      as: item.as || null,
      attributes: item.attributes || null,
      where: item.where || null,
      eager: item.eager !== undefined ? item.eager : null,
      required: item.required === true,
      include: item.include ? normalizeInclude(item.include) : [],
    };
  });
}

/**
 * Resolves the effective eager flag for an include.
 * Priority: include.eager > globalEager > false
 * @param {object} include
 * @param {boolean} [globalEager=false]
 * @returns {boolean}
 */
function resolveEager(include, globalEager = false) {
  if (include.eager !== null && include.eager !== undefined) return include.eager;
  return globalEager;
}

/**
 * Resolves the alias for an include descriptor.
 * Priority: include.as > association.as > targetModel.alias > auto-generated
 * @param {object} include
 * @param {typeof import('../core/Model.js').Model} model
 * @returns {string}
 */
function resolveIncludeAlias(include, model) {
  if (include.as) return include.as;
  const assoc = resolveAssociation(model, include);
  if (assoc?.as) return assoc.as;
  if (include.model?.alias) return include.model.alias;
  return include.model.modelName.toLowerCase() + 's';
}

function buildIncludeSqlAliasMap(includes, model, dml, globalEager = false) {
  const used = new Set();
  const parentAlias = model.alias || dml._getTableName(model);
  if (parentAlias) used.add(parentAlias);

  const aliases = new Map();
  _addIncludeSqlAliases(includes, aliases, used, dml, globalEager);
  return aliases;
}

function _addIncludeSqlAliases(includes, aliases, used, dml, globalEager) {
  for (const inc of includes || []) {
    if (!inc.model) continue;
    const { tableName, alias: targetAlias } = dml._schema(inc.model);
    const preferredAlias = targetAlias || inc.model.alias || tableName;
    const sqlAlias = _uniqueAlias(preferredAlias, used, inc.as || tableName);
    aliases.set(inc, sqlAlias);
    _addIncludeSqlAliases(eagerNestedIncludes(inc, globalEager), aliases, used, dml, globalEager);
  }
}

/**
 * Loads eager-loading includes onto an array of model instances.
 * Uses separate queries with WHERE IN for efficiency.
 * @param {import('../core/Model.js').Model[]} instances
 * @param {object[]} includes
 * @param {typeof import('../core/Model.js').Model} model
 * @param {import('../adapters/abstract/DMLAbstract.js').DMLAbstract} dml
 * @returns {Promise<void>}
 */
async function loadIncludes(instances, includes, model, dml, queryOptions = {}) {
  await Promise.all(includes.map(async inc => {
    if (!inc.model) return;

    const assoc = resolveAssociation(model, inc);
    const alias = resolveIncludeAlias(inc, model);

    if (!assoc) {
      for (const instance of instances) {
        instance.setDataValue(alias, []);
      }
      return;
    }

    switch (assoc.type) {
      case 'hasMany':
        await _loadHasMany(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'hasOne':
        await _loadHasOne(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'belongsTo':
        await _loadBelongsTo(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'belongsToMany':
        await _loadBelongsToMany(instances, inc, assoc, alias, dml, queryOptions);
        break;
      default:
        for (const instance of instances) {
          instance.setDataValue(alias, null);
        }
    }
  }));
  return instances.filter(instance => includes.every(inc => {
    if (!inc.required || !inc.model) return true;
    const value = instance.getDataValue(resolveIncludeAlias(inc, model));
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
  }));
}

async function loadNestedLazyIncludes(instances, includes, model, dml, queryOptions = {}) {
  const globalEager = queryOptions.eager ?? dml._adapter.eager ?? false;
  for (const inc of includes || []) {
    if (!inc.model || !inc.include?.length) continue;
    let children = _attachedInstances(instances, inc, model);
    if (children.length === 0) continue;

    const lazyIncludes = lazyNestedIncludes(inc, globalEager);
    if (lazyIncludes.length > 0) {
      children = await loadIncludes(children, lazyIncludes, inc.model, dml, queryOptions);
      _retainAttachedInstances(instances, inc, model, children);
    }

    const eagerIncludes = eagerNestedIncludes(inc, globalEager);
    if (eagerIncludes.length > 0) {
      children = await loadNestedLazyIncludes(children, eagerIncludes, inc.model, dml, queryOptions);
      _retainAttachedInstances(instances, inc, model, children);
    }
  }
  return instances;
}

function eagerNestedIncludes(include, globalEager = false) {
  return (include.include || []).filter(inc => resolveEager(inc, globalEager));
}

function lazyNestedIncludes(include, globalEager = false) {
  return (include.include || []).filter(inc => !resolveEager(inc, globalEager));
}

function resolveAssociation(model, include) {
  if (!model?.associations || !include?.model) return null;
  if (include.as && model.associations[include.as]) return model.associations[include.as];
  const candidates = [...new Set(Object.values(model.associations))]
    .filter(association => association?.target === include.model);
  return candidates.length === 1 ? candidates[0] : (model.associations[include.model.modelName] || null);
}

function _uniqueAlias(preferred, used, fallback) {
  const base = preferred || fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  if (fallback && fallback !== base && !used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }
  let index = 2;
  let alias = `${base}_${index}`;
  while (used.has(alias)) {
    index += 1;
    alias = `${base}_${index}`;
  }
  used.add(alias);
  return alias;
}

function _definedValues(items, getValue) {
  return [...new Set(items.map(getValue).filter(value => value !== null && value !== undefined))];
}

function _groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function _indexBy(items, getKey) {
  const index = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (key !== null && key !== undefined && !index.has(key)) index.set(key, item);
  }
  return index;
}

async function _loadHasMany(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = _definedValues(instances, i => i.getDataValue(parentPK));

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, _requiredAttributes(inc, target, [fkAttr]));
  const childrenByFK = _groupBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childrenByFK.get(pkVal) || []);
  }
  trimProjection(children, inc.attributes, inc.include, target);
}

async function _loadHasOne(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = _definedValues(instances, i => i.getDataValue(parentPK));

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, _requiredAttributes(inc, target, [fkAttr]));
  const childByFK = _indexBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childByFK.get(pkVal) || null);
  }
  trimProjection(children, inc.attributes, inc.include, target);
}

async function _loadBelongsTo(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const targetPK = target.primaryKeyAttribute || 'id';

  const fkValues = _definedValues(instances, i => i.getDataValue(fkAttr));

  if (fkValues.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const targets = await _selectInChunks(dml, target, targetPK, fkValues, inc, queryOptions, _requiredAttributes(inc, target, [targetPK]));
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const fkVal = instance.getDataValue(fkAttr);
    instance.setDataValue(alias, targetByPK.get(fkVal) || null);
  }
  trimProjection(targets, inc.attributes, inc.include, target);
}

async function _loadBelongsToMany(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const sourcePK = assoc.source.primaryKeyAttribute || 'id';
  const targetPK = target.primaryKeyAttribute || 'id';
  const otherKeyAttr = assoc.otherKey;

  const sourceIds = _definedValues(instances, i => i.getDataValue(sourcePK));

  if (sourceIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const junctionRows = await dml.selectAssociationJunctionRows(assoc, sourceIds, queryOptions);
  const junctionRowsBySource = _groupBy(junctionRows, row => row[assoc.foreignKey]);

  const targetIds = [...new Set(junctionRows.map(r => r[otherKeyAttr]).filter(id => id !== null && id !== undefined))];

  if (targetIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const targets = await _selectInChunks(dml, target, targetPK, targetIds, inc, queryOptions, _requiredAttributes(inc, target, [targetPK]));
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(sourcePK);
    const relatedRows = junctionRowsBySource.get(pkVal) || [];
    const matching = relatedRows
      .map(row => targetByPK.get(row[otherKeyAttr]))
      .filter(Boolean);
    instance.setDataValue(alias, matching);
  }
  trimProjection(targets, inc.attributes, inc.include, target);
}

function _withRequiredAttributes(attributes, required) {
  if (!Array.isArray(attributes) || attributes.length === 0) return undefined;
  return [...new Set([...attributes, ...required])];
}

function _requiredAttributes(include, model, attributes) {
  if (!include.include?.length) return attributes;
  return [...new Set([...attributes, model.primaryKeyAttribute || 'id'])];
}

function chunks(values, size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function _selectInChunks(dml, model, field, values, inc, queryOptions, requiredAttributes) {
  const rows = await Promise.all(chunks(values).map(ids => {
    const relationWhere = { [field]: { [Op.in]: ids } };
    const where = inc.where ? { [Op.and]: [relationWhere, inc.where] } : relationWhere;
    return dml.selectAll(model, {
      where,
      attributes: _withRequiredAttributes(inc.attributes, requiredAttributes),
      include: inc.include || [],
      eager: queryOptions.eager,
      transaction: queryOptions.transaction
    });
  }));
  return rows.flat();
}

function trimProjection(instances, attributes, includes = [], model = null) {
  if (!Array.isArray(attributes) || attributes.length === 0) return;
  const selected = new Set(attributes);
  for (const include of includes || []) {
    if (include.model && model) selected.add(resolveIncludeAlias(include, model));
  }
  for (const instance of instances) {
    for (const key of Object.keys(instance.dataValues)) {
      if (!selected.has(key)) delete instance.dataValues[key];
    }
  }
}

function _attachedInstances(instances, inc, model) {
  const alias = resolveIncludeAlias(inc, model);
  const attached = [];
  for (const instance of instances) {
    const value = instance.getDataValue(alias);
    if (Array.isArray(value)) attached.push(...value);
    else if (value) attached.push(value);
  }
  return attached;
}

function _retainAttachedInstances(instances, inc, model, retained) {
  const retainedSet = new Set(retained);
  const alias = resolveIncludeAlias(inc, model);
  for (const instance of instances) {
    const value = instance.getDataValue(alias);
    if (Array.isArray(value)) {
      instance.setDataValue(alias, value.filter(child => retainedSet.has(child)));
    } else if (value && !retainedSet.has(value)) {
      instance.setDataValue(alias, null);
    }
  }
}

/**
 * Processes rows from a JOIN query into model instances with nested includes.
 * Columns are in "alias__column" format.
 * @param {object[]} rows
 * @param {typeof import('../core/Model.js').Model} model
 * @param {object[]} includes - Eager include descriptors
 * @param {import('../adapters/abstract/DMLAbstract.js').DMLAbstract} dml
 * @returns {import('../core/Model.js').Model[]}
 */
function processJoinedRows(rows, model, includes, dml, includeSqlAliases = buildIncludeSqlAliasMap(includes, model, dml), globalEager = false) {
  if (rows.length === 0) return [];

  const parentAlias = model.alias;
  const { schema: parentSchema } = dml._schema(model);
  const parentPK = model.primaryKeyAttribute || 'id';
  const parentPKCol = parentPK;
  const includeNodes = _buildIncludeNodes(includes, model, dml, includeSqlAliases, globalEager);
  const nodesByAlias = _indexNodesBySqlAlias(includeNodes);

  const parentMap = new Map();

  for (const row of rows) {
    const parentData = {};
    const aliasData = new Map();

    for (const [key, value] of Object.entries(row)) {
      const sepIdx = key.indexOf('.');
      if (sepIdx === -1) continue;
      const tblAlias = key.slice(0, sepIdx);
      const colName = key.slice(sepIdx + 1);

      if (tblAlias === parentAlias) {
        parentData[colName] = value;
      } else if (nodesByAlias.has(tblAlias)) {
        if (!aliasData.has(tblAlias)) aliasData.set(tblAlias, {});
        aliasData.get(tblAlias)[colName] = value;
      }
    }

    const pkVal = parentData[parentPKCol];
    if (!parentMap.has(pkVal)) {
      parentMap.set(pkVal, { raw: parentData, children: new Map() });
    }
    const entry = parentMap.get(pkVal);
    for (const node of includeNodes) _addJoinedNode(entry, node, aliasData);
  }

  const instances = [];
  for (const [, entry] of parentMap) {
    const attrParent = dml._toAttrNames(entry.raw, parentSchema);
    const instance = new model(attrParent, { _isNew: false });
    _attachJoinedIncludes(instance, entry, includeNodes, dml);
    instances.push(instance);
  }

  return instances;
}

function _buildIncludeNodes(includes, parentModel, dml, includeSqlAliases, globalEager) {
  return (includes || []).filter(inc => inc.model).map(inc => {
    const { schema, alias: sqlAlias } = dml._schema(inc.model);
    return {
      inc,
      model: inc.model,
      schema,
      sqlAlias: includeSqlAliases.get(inc) || sqlAlias || dml._getTableName(inc.model),
      propertyAlias: resolveIncludeAlias(inc, parentModel),
      assoc: resolveAssociation(parentModel, inc),
      attributes: inc.attributes,
      children: _buildIncludeNodes(eagerNestedIncludes(inc, globalEager), inc.model, dml, includeSqlAliases, globalEager),
    };
  });
}

function _indexNodesBySqlAlias(nodes, index = new Map()) {
  for (const node of nodes) {
    index.set(node.sqlAlias, node);
    _indexNodesBySqlAlias(node.children, index);
  }
  return index;
}

function _addJoinedNode(parentEntry, node, aliasData) {
  const raw = aliasData.get(node.sqlAlias);
  if (!raw || Object.values(raw).every(value => value === null)) return;

  const pkAttr = node.model.primaryKeyAttribute || 'id';
  const pkValue = raw[pkAttr];
  if (!parentEntry.children.has(node)) parentEntry.children.set(node, new Map());
  const childMap = parentEntry.children.get(node);
  if (!childMap.has(pkValue)) childMap.set(pkValue, { raw, children: new Map() });
  const childEntry = childMap.get(pkValue);

  for (const childNode of node.children) _addJoinedNode(childEntry, childNode, aliasData);
}

function _attachJoinedIncludes(instance, entry, nodes, dml) {
  for (const node of nodes) {
    const childEntries = [...(entry.children.get(node)?.values() || [])];
    if (node.assoc?.type === 'belongsTo' || node.assoc?.type === 'hasOne') {
      const childInstance = childEntries.length > 0 ? _joinedInstance(childEntries[0], node, dml) : null;
      instance.setDataValue(node.propertyAlias, childInstance);
    } else {
      instance.setDataValue(node.propertyAlias, childEntries.map(childEntry => _joinedInstance(childEntry, node, dml)));
    }
  }
}

function _joinedInstance(entry, node, dml) {
  const attrRow = _pickAttributes(dml._toAttrNames(entry.raw, node.schema), node.attributes);
  const instance = new node.model(attrRow, { _isNew: false, _partial: !!node.attributes });
  _attachJoinedIncludes(instance, entry, node.children, dml);
  return instance;
}

function _pickAttributes(values, attributes) {
  if (!Array.isArray(attributes) || attributes.length === 0) return values;
  return Object.fromEntries(attributes.filter(key => key in values).map(key => [key, values[key]]));
}

/**
 * Base Model class. All user-defined models must extend this.
 * Provides static methods for CRUD operations and instance methods for record manipulation.
 *
 * @template TValues
 */
class Model {
  /**
   * Creates a new Model instance representing a record.
   * @param {Partial<TValues>} values - The record values.
   * @param {import('../../types/index.d.ts').BuildOptions} [options] - Creation options.
   */
  constructor(values = {}, options = {}) {
    this._options = options;
    this.dataValues = {};
    this._changed = {};
    this._isNew = options._isNew !== undefined ? options._isNew : true;

    const Ctor = this.constructor;
    const attrs = Ctor.rawAttributes || {};

    if (options._partial) {
      for (const [key, value] of Object.entries(values)) this.dataValues[key] = value;
      return;
    }

    for (const key of Object.keys(attrs)) {
      if (Ctor._isVirtualAttribute(attrs[key]) && !(key in values) && attrs[key].defaultValue === undefined) {
        continue;
      } else if (key in values) {
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
   * @param {import('../../types/index.d.ts').AttributeMap} attributes - Attribute definitions.
   * @param {import('../../types/index.d.ts').ModelOptions} options - Model options.
   * @returns {typeof Model}
   */
  static init(attributes, options = {}) {
    if (!attributes || typeof attributes !== 'object') throw new Error('Model.init requires an attributes object');

    this.rawAttributes = {};
    this.primaryKeyAttribute = null;
    this.autoIncrementAttribute = null;

    for (const [name, def] of Object.entries(attributes)) {
      if (!def.type) throw new Error(`Attribute "${name}" must have a type`);
      for (const action of [def.onDelete, def.onUpdate]) {
        if (action !== undefined && !['RESTRICT', 'CASCADE', 'SET NULL'].includes(action)) {
          throw new ModelError(`Attribute "${name}" has an invalid foreign-key action`, { code: 'SEQ_ASSOCIATION_INVALID_ACTION' });
        }
      }
      this.rawAttributes[name] = { ...def, type: this._normalizeDataType(def.type) };
      if (def.primaryKey) {
        if (this.primaryKeyAttribute) throw new Error('Model must not have more than one primaryKey attribute');
        this.primaryKeyAttribute = name;
      }
      if (def.autoIncrement) {
        if (this.autoIncrementAttribute) throw new Error('Model must not have more than one autoIncrement attribute');
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
        this.rawAttributes[createdAtField] = {type: DataTypes.DATE, allowNull: true, defaultValue: () => new Date()};
      }
      if (!this.rawAttributes[updatedAtField]) {
        this.rawAttributes[updatedAtField] = {type: DataTypes.DATE, allowNull: true, defaultValue: () => new Date()};
      }
    }

    this.modelName = options.modelName || this.name;
    this.tableName = options.tableName;
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

  static _isVirtualAttribute(def) {
    return def?.type?.key === 'VIRTUAL' || def?.type?.constructor?.name === 'VirtualType';
  }

  static _resolveThrough(through) {
    if (typeof through === 'string') {
      return { through, throughModel: null, throughTable: through };
    }
    const throughModel = through?.model || through;
    if (typeof throughModel === 'function') {
      const throughTable = throughModel._resolvedTableName
        || throughModel.tableName
        || throughModel.modelName
        || throughModel.name;
      return { through, throughModel, throughTable };
    }
    return { through, throughModel: null, throughTable: through };
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
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) throw new ModelError(`Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasMany association`, { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } });
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase() + 's';
    const assoc = new Association('hasMany', this, target, { ...options, foreignKey: fkAttr });
    this._storeAssociation(assoc, target);
    return this;
  }

  static hasOne(target, options = {}) {
    if (!target) throw new ModelError('hasOne requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, target.primaryKeyAttribute || 'id');
    if (target.rawAttributes && !target.rawAttributes[fkAttr]) throw new ModelError(`Target model "${target.modelName}" must have a "${fkAttr}" attribute for hasOne association`, { code: 'SEQ_ASSOCIATION_MISSING_FK', details: { target: target.modelName, foreignKey: fkAttr } });
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase();
    const assoc = new Association('hasOne', this, target, { ...options, foreignKey: fkAttr });
    this._storeAssociation(assoc, target);
    return this;
  }

  static belongsTo(target, options = {}) {
    if (!target) throw new ModelError('belongsTo requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    const fkAttr = options.foreignKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    if (this.rawAttributes && !this.rawAttributes[fkAttr]) throw new ModelError(`Model "${this.modelName}" must have a "${fkAttr}" attribute for belongsTo association`,{ code: 'SEQ_ASSOCIATION_MISSING_FK', details: { source: this.modelName, foreignKey: fkAttr } });
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase();
    const assoc = new Association('belongsTo', this, target, { ...options, foreignKey: fkAttr });
    this._storeAssociation(assoc, target);
    return this;
  }

  static belongsToMany(target, options = {}) {
    if (!target) throw new ModelError('belongsToMany requires a target model', { code: 'SEQ_ASSOCIATION_INVALID_TARGET' });
    if (!options.through) throw new ModelError('belongsToMany requires a "through" option', { code: 'SEQ_ASSOCIATION_MISSING_THROUGH' });

    const fkAttr = options.foreignKey || this._defaultForeignKeyName(this.modelName, this.primaryKeyAttribute || 'id');
    const otherKey = options.otherKey || this._defaultForeignKeyName(target.modelName || target.name, target.primaryKeyAttribute || 'id');
    const throughInfo = this._resolveThrough(options.through);
    if (!this.associations) this.associations = {};
    if (!options.as) options.as = (target.modelName || target.name || 'unknown').toLowerCase() + 's';
    const assoc = new Association('belongsToMany', this, target, { ...options, ...throughInfo, foreignKey: fkAttr, otherKey });
    this._storeAssociation(assoc, target);
    return this;
  }

  static _storeAssociation(association, target) {
    const alias = association.as || target.modelName || target.name;
    this.associations[alias] = association;
    const legacyKey = target.modelName || target.name;
    if (legacyKey && !Object.prototype.hasOwnProperty.call(this.associations, legacyKey)) {
      Object.defineProperty(this.associations, legacyKey, { value: association, configurable: true, writable: true });
    }
  }

  /**
   * Returns this model's associations as include descriptors.
   * @returns {Array<{ model: typeof Model, name: string, as: string, foreignKey: string|null, otherKey?: string|null }>}
   */
  static getAssociationIncludes() {
    const seen = new Set();
    const includes = [];
    for (const association of Object.values(this.associations || {})) {
      if (!association || seen.has(association)) continue;
      seen.add(association);
      const include = {
        model: association.target,
        name: association.target?.modelName || association.target?.name,
        as: association.as || association.target?.modelName || association.target?.name,
        foreignKey: association.foreignKey || null
      };
      if (association.otherKey) include.otherKey = association.otherKey;
      includes.push(include);
    }
    return includes;
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

  static async _measureOperation(operation, execute) {
    const startedAt = performance.now();
    try {
      const result = await execute();
      const operationDurationMs = performance.now() - startedAt;
      const level = this.seq?._isSlowOperation(operationDurationMs) ? 'warn' : 'trace';
      this._log(level, `${this.modelName}.${operation}`, {
        type: 'model-operation',
        operation,
        model: this.modelName,
        operationDurationMs
      });
      return result;
    } catch (error) {
      const operationDurationMs = performance.now() - startedAt;
      this._log('error', `${this.modelName}.${operation}`, {
        type: 'model-operation',
        operation,
        model: this.modelName,
        operationDurationMs,
        error: { name: error.name, message: error.message, code: error.code }
      });
      throw error;
    }
  }

  /**
   * Registers a model hook.
   * @param {string} name
   * @param {Function} handler
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

  static async _invalidateCache(options = {}) {
    if (!this.seq || !this.seq.cache) return;
    if (options.transaction && typeof options.transaction.afterCommit === 'function') {
      options.transaction.afterCommit(() => this.seq.cache.invalidate(this.modelName));
    } else {
      await this.seq.cache.invalidate(this.modelName);
    }
  }

  /**
   * Creates a new record.
   * @template {typeof Model} T
   * @this {T}
   * @param {object} values
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<InstanceType<T>>}
   */
  static async create(values = {}, options = {}) {
    if (options.include) {
      const includes = normalizeInclude(options.include);
      this._validateIncludes(includes);
      const run = transaction => this._createWithIncludes(values, { ...options, include: includes, transaction });
      if (options.transaction || !this.seq) return run(options.transaction);
      return this.seq.transaction(run);
    }

    //this._log('trace', `${this.modelName}.create`, values);
    if (options.hooks !== false) await this._runHooks('beforeCreate', values, options);
    const result = await this._adapter.dml.insert(this, values, options);
    if (options.hooks !== false) await this._runHooks('afterCreate', result, options);
    await this._invalidateCache(options);
    return result;
  }

  static async _createWithIncludes(values = {}, options = {}) {
    const includes = options.include || [];
    this._validateNestedCreateIncludes(includes);
    const parentValues = this._stripNestedCreateValues(values, includes);
    if (options.hooks !== false) await this._runHooks('beforeCreate', parentValues, options);
    const result = await this._adapter.dml.insert(this, parentValues, options);

    for (const include of includes) await this._createIncludedAssociation(result, values, include, options);

    if (options.hooks !== false) await this._runHooks('afterCreate', result, options);
    await this._invalidateCache(options);
    return result;
  }

  static _validateNestedCreateIncludes(includes) {
    for (const include of includes) {
      const assoc = resolveAssociation(this, include);
      const alias = resolveIncludeAlias(include, this);
      if (!assoc) throw new ModelError(`No association found for include "${alias}" on model "${this.modelName}"`, { code: 'SEQ_INCLUDE_ASSOCIATION_NOT_FOUND' });
      if (assoc.type !== 'hasMany' && assoc.type !== 'hasOne') {
        throw new ModelError(`Nested create only supports hasMany and hasOne includes; "${alias}" is ${assoc.type}`, {
          code: 'SEQ_NESTED_CREATE_UNSUPPORTED_ASSOCIATION',
          details: { model: this.modelName, include: alias, associationType: assoc.type }
        });
      }
    }
  }

  static _stripNestedCreateValues(values, includes) {
    const nestedKeys = new Set(includes.map(include => resolveIncludeAlias(include, this)));
    return Object.fromEntries(Object.entries(values).filter(([key]) => !nestedKeys.has(key)));
  }

  static async _createIncludedAssociation(parent, sourceValues, include, options) {
    const assoc = resolveAssociation(this, include);
    const alias = resolveIncludeAlias(include, this);

    const nestedValue = sourceValues[alias];
    if (nestedValue === undefined) return;

    const parentPK = assoc.source.primaryKeyAttribute || 'id';
    const parentPKValue = parent.getDataValue(parentPK);
    const childOptions = { ...options, include: include.include || [] };

    if (assoc.type === 'hasMany') {
      if (!Array.isArray(nestedValue)) throw new ModelError(`Nested create include "${alias}" must be an array for hasMany association`, {code: 'SEQ_NESTED_CREATE_INVALID_VALUE', details: { model: this.modelName, include: alias, associationType: assoc.type }});
      const children = [];
      for (const childValue of nestedValue) children.push(await assoc.target.create({ ...childValue, [assoc.foreignKey]: parentPKValue }, childOptions));
      parent.setDataValue(alias, children);
      return;
    }

    if (nestedValue === null) {
      parent.setDataValue(alias, null);
      return;
    }
    if (typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
      throw new ModelError(`Nested create include "${alias}" must be an object for hasOne association`, {
        code: 'SEQ_NESTED_CREATE_INVALID_VALUE',
        details: { model: this.modelName, include: alias, associationType: assoc.type }
      });
    }
    const child = await assoc.target.create({ ...nestedValue, [assoc.foreignKey]: parentPKValue }, childOptions);
    parent.setDataValue(alias, child);
  }

  /**
   * Creates multiple records.
   * @template {typeof Model} T
   * @this {T}
   * @param {object[]} records
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<Array<InstanceType<T>>>}
   */
  static async bulkCreate(records = [], options = {}) {
    //this._log('trace', `${this.modelName}.bulkCreate`, records);
    if (options.hooks !== false) await this._runHooks('beforeBulkCreate', records, options);
    const result = await this._adapter.dml.bulkInsert(this, records, options);
    if (options.hooks !== false) await this._runHooks('afterBulkCreate', result, options);
    await this._invalidateCache(options);
    return result;
  }

  /**
   * Creates a record or updates the existing one matched by the adapter.
   * @template {typeof Model} T
   * @this {T}
   * @param {object} values
   * @param {import('../../types/index.d.ts').UpsertOptions} [options]
   * @returns {Promise<[InstanceType<T>, boolean]>}
   */
  static async upsert(values = {}, options = {}) {
    //this._log('trace', `${this.modelName}.upsert`, values, options);
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where))) throw new ValidationWhereError();
    if (options.include) {
      const includes = normalizeInclude(options.include);
      this._validateIncludes(includes);
      const run = transaction => this._upsertWithIncludes(values, { ...options, include: includes, transaction });
      if (options.transaction || !this.seq) return run(options.transaction);
      return this.seq.transaction(run);
    }

    if (options.hooks !== false) await this._runHooks('beforeUpsert', values, options);
    const result = await this._adapter.dml.upsert(this, values, options);
    if (options.hooks !== false) await this._runHooks('afterUpsert', result, options);
    await this._invalidateCache(options);
    return result;
  }

  static async _upsertWithIncludes(values = {}, options = {}) {
    const includes = options.include || [];
    this._validateNestedCreateIncludes(includes);
    const parentValues = this._stripNestedCreateValues(values, includes);
    const mutationOptions = { ...options };
    delete mutationOptions.include;

    if (options.hooks !== false) await this._runHooks('beforeUpsert', parentValues, mutationOptions);
    const result = await this._adapter.dml.upsert(this, parentValues, mutationOptions);
    const [parent] = result;

    for (const include of includes) await this._upsertIncludedAssociation(parent, values, include, mutationOptions);

    if (options.hooks !== false) await this._runHooks('afterUpsert', result, mutationOptions);
    await this._invalidateCache(mutationOptions);
    return result;
  }

  static async _upsertIncludedAssociation(parent, sourceValues, include, options) {
    const assoc = resolveAssociation(this, include);
    const alias = resolveIncludeAlias(include, this);
    const nestedValue = sourceValues[alias];
    if (nestedValue === undefined) return;

    const parentPK = assoc.source.primaryKeyAttribute || 'id';
    const parentPKValue = parent.getDataValue(parentPK);
    const childOptions = { ...options, include: include.include || [] };

    if (assoc.type === 'hasMany') {
      if (!Array.isArray(nestedValue)) throw new ModelError(`Nested upsert include "${alias}" must be an array for hasMany association`, { code: 'SEQ_NESTED_UPSERT_INVALID_VALUE', details: { model: this.modelName, include: alias, associationType: assoc.type } });
      const children = [];
      for (const childValue of nestedValue) {
        const [child] = await assoc.target.upsert({ ...childValue, [assoc.foreignKey]: parentPKValue }, childOptions);
        children.push(child);
      }
      parent.setDataValue(alias, children);
      return;
    }

    if (nestedValue === null) {
      parent.setDataValue(alias, null);
      return;
    }
    if (typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
      throw new ModelError(`Nested upsert include "${alias}" must be an object or null for hasOne association`, {
        code: 'SEQ_NESTED_UPSERT_INVALID_VALUE',
        details: { model: this.modelName, include: alias, associationType: assoc.type }
      });
    }
    const [child] = await assoc.target.upsert({ ...nestedValue, [assoc.foreignKey]: parentPKValue }, childOptions);
    parent.setDataValue(alias, child);
  }

  /**
   * Finds a record by primary key.
   * @template {typeof Model} T
   * @this {T}
   * @param {*} id
   * @param {import('../../types/index.d.ts').QueryOptions} [options]
   * @returns {Promise<InstanceType<T>|null>}
   */
  static async findByPk(id, options = {}) {
    //this._log('trace', `${this.modelName}.findByPk`, id);
    if (!this.primaryKeyAttribute) throw new Error(`Model "${this.modelName}" has no primary key`);
    const where = { [this.primaryKeyAttribute]: id };
    return this.findOne({ ...options, where });
  }

  /**
   * Finds a record matching where or creates it when it does not exist.
   * @template {typeof Model} T
   * @this {T}
   * @param {object} where
   * @param {object} values
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<[InstanceType<T>, boolean]>}
   */
  static async findOrCreate(where, values = {}, options = {}) {
    const instance = await this.findOne({ ...options, where });
    if (instance) return [instance, false];

    return [await this.create({ ...values, ...where }, options), true];
  }

  static _toPlainValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(item => this._toPlainValue(item));
    if (value instanceof Model) return value.get({ plain: true });
    if (value instanceof Date) return value;
    if (typeof value === 'object') {
      const plain = {};
      for (const [key, child] of Object.entries(value)) plain[key] = this._toPlainValue(child);
      return plain;
    }
    return value;
  }

  static _normalizeFindResult(result, plain = false) {
    if (!plain || result === null || result === undefined) return result;
    return this._toPlainValue(result);
  }

  /**
   * Finds one record matching the options.
   * @template {typeof Model} T
   * @this {T}
   * @param {import('../../types/index.d.ts').QueryOptions} [options]
   * @returns {Promise<InstanceType<T>|null>}
   */
  static async findOne(options = {}) {
    //this._log('trace', `${this.modelName}.findOne`, options);
    if (options.hooks !== false) await this._runHooks('beforeFind', options);
    
    const useCache = options.cache !== false && !options.transaction && this.seq?.cache;
    if (useCache) {
      const cacheResult = await this.seq.cache.get(this.modelName, 'findOne', options);
      if (cacheResult.hit) return this._normalizeFindResult(cacheResult.value, options.plain);
    }

    const result = await this._adapter.dml.selectOne(this, options);
    if (options.hooks !== false) await this._runHooks('afterFind', result, options);
    
    if (useCache) {
      await this.seq.cache.set(this.modelName, 'findOne', options, result);
    }
    
    return this._normalizeFindResult(result, options.plain);
  }

  /**
   * Finds all records matching the options.
   * @template {typeof Model} T
   * @this {T}
   * @param {import('../../types/index.d.ts').QueryOptions} [options]
   * @returns {Promise<Array<InstanceType<T>>>}
   */
  static async findAll(options = {}) {
    if (options.hooks !== false) await this._runHooks('beforeFind', options);
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where))) throw new ValidationWhereError();
    if (options.order !== undefined) this._validateOrder(options.order);
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1))  throw new ValidationLimitError();
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) throw new ValidationOffsetError();
    if (options.attributes !== undefined) this._validateAttributes(options.attributes);
    if (options.include) options.include = normalizeInclude(options.include);
    this._validateIncludes(options.include || []);
    //this._log('trace', `${this.modelName}.findAll`, options);
    
    const useCache = options.cache !== false && !options.transaction && this.seq?.cache;
    if (useCache) {
      const cacheResult = await this.seq.cache.get(this.modelName, 'findAll', options);
      if (cacheResult.hit) return this._normalizeFindResult(cacheResult.value, options.plain);
    }
    const result = await this._adapter.dml.selectAll(this, options);
    if (options.hooks !== false) await this._runHooks('afterFind', result, options);
    if (useCache) await this.seq.cache.set(this.modelName, 'findAll', options, result);
    return this._normalizeFindResult(result, options.plain);
  }

  static _validateIncludes(includes) {
    for (const include of includes || []) {
      if (!include.model) throw new ModelError('include requires a model', { code: 'SEQ_INCLUDE_INVALID_MODEL' });
      if (include.attributes !== null) include.model._validateAttributes(include.attributes);
      include.model._validateIncludes(include.include || []);
    }
  }

  static _validateOrder(order) {
    if (!Array.isArray(order) || order.some(item => !Array.isArray(item) || item.length < 1 || item.length > 2)) {
      throw new ValidationOrderError();
    }
    for (const [attribute, direction = 'ASC'] of order) {
      if (typeof attribute !== 'string' || !Object.prototype.hasOwnProperty.call(this.rawAttributes || {}, attribute)) {
        throw new ValidationOrderError('order contains an unknown attribute');
      }
      if (typeof direction !== 'string' || !['ASC', 'DESC'].includes(direction.toUpperCase())) {
        throw new ValidationOrderError('order direction must be ASC or DESC');
      }
    }
  }

  static _validateAttributes(attributes) {
    if (!Array.isArray(attributes) || attributes.length === 0 || attributes.some(attribute =>
      typeof attribute !== 'string' || !Object.prototype.hasOwnProperty.call(this.rawAttributes || {}, attribute)
    )) {
      throw new ValidationError('attributes must contain known model attributes', { code: 'SEQ_VALIDATION_ATTRIBUTES' });
    }
  }

  /**
   * Counts records matching the options.
   * @param {import('../../types/index.d.ts').QueryOptions} [options]
   * @returns {Promise<number>}
   */
  static async count(options = {}) {
    if (options.hooks !== false) await this._runHooks('beforeCount', options);
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where))) throw new ValidationWhereError();
    //this._log('trace', `${this.modelName}.count`, options);
    const useCache = options.cache !== false && !options.transaction && this.seq?.cache;
    if (useCache) {
      const cacheResult = await this.seq.cache.get(this.modelName, 'count', options);
      if (cacheResult.hit) return cacheResult.value;
    }
    const result = await this._adapter.dml.count(this, options);
    if (options.hooks !== false) await this._runHooks('afterCount', result, options);
    if (useCache) await this.seq.cache.set(this.modelName, 'count', options, result);
    return result;
  }

  /**
   * Finds records and returns the total count for the same base query.
   * Pagination options apply only to rows, matching Sequelize's common usage.
   * @template {typeof Model} T
   * @this {T}
   * @param {import('../../types/index.d.ts').QueryOptions} [options]
   * @returns {Promise<{ count: number, rows: Array<InstanceType<T>> }>}
   */
  static async findAndCountAll(options = {}) {
    //this._log('trace', `${this.modelName}.findAndCountAll`, options);
    const findOptions = { ...options };
    const countOptions = { ...options };
    delete countOptions.attributes;
    delete countOptions.order;
    delete countOptions.limit;
    delete countOptions.offset;
    const [count, rows] = await Promise.all([this.count(countOptions), this.findAll(findOptions)]);

    return { count, rows };
  }

  /**
   * Updates records matching the where clause.
   * @param {object} values
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<Model[]>}
   */
  static async update(values, options = {}) {
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where)))throw new ValidationWhereError();
    if (options.include) {
      const includes = normalizeInclude(options.include);
      this._validateIncludes(includes);
      const run = transaction => this._updateWithIncludes(values, { ...options, include: includes, transaction });
      if (options.transaction || !this.seq) return run(options.transaction);
      return this.seq.transaction(run);
    }

    //this._log('trace', `${this.modelName}.update`, values, options);
    if (options.hooks !== false) await this._runHooks('beforeUpdate', values, options);
    const result = await this._adapter.dml.update(this, values, options);
    if (options.hooks !== false) await this._runHooks('afterUpdate', result, options);
    await this._invalidateCache(options);
    return result;
  }

  static async _updateWithIncludes(values = {}, options = {}) {
    const includes = options.include || [];
    this._validateNestedCreateIncludes(includes);

    const where = this._resolveNestedUpdateWhere(values, options);
    const parentValues = this._stripNestedCreateValues(values, includes);
    const mutationOptions = { ...options, where };
    delete mutationOptions.include;
    if (options.hooks !== false) await this._runHooks('beforeUpdate', parentValues, mutationOptions);
    const result = await this._adapter.dml.update(this, parentValues, mutationOptions);
    for (const parent of result) for (const include of includes) await this._replaceIncludedAssociation(parent, values, include, mutationOptions);
    if (options.hooks !== false) await this._runHooks('afterUpdate', result, mutationOptions);
    await this._invalidateCache(mutationOptions);
    return result;
  }

  static _resolveNestedUpdateWhere(values, options) {
    if (options.where) return options.where;
    const pk = this.primaryKeyAttribute || 'id';
    const pkValue = values?.[pk];
    if (pkValue === undefined || pkValue === null) {
      throw new ModelError(`Nested update for model "${this.modelName}" requires options.where or a "${pk}" value`, {code: 'SEQ_NESTED_UPDATE_MISSING_TARGET',details: { model: this.modelName, primaryKey: pk }});
    }
    return { [pk]: pkValue };
  }

  static async _replaceIncludedAssociation(parent, sourceValues, include, options) {
    const assoc = resolveAssociation(this, include);
    const alias = resolveIncludeAlias(include, this);
    const nestedValue = sourceValues[alias];
    if (nestedValue === undefined) return;

    const parentPK = assoc.source.primaryKeyAttribute || 'id';
    const parentPKValue = parent.getDataValue(parentPK);
    const childOptions = { ...options, include: include.include || [] };

    if (assoc.type === 'hasMany') {
      if (!Array.isArray(nestedValue)) throw new ModelError(`Nested update include "${alias}" must be an array for hasMany association`, {code: 'SEQ_NESTED_UPDATE_INVALID_VALUE', details: { model: this.modelName, include: alias, associationType: assoc.type }});
      await assoc.target.destroy({ ...options, where: { [assoc.foreignKey]: parentPKValue } });
      const children = [];
      for (const childValue of nestedValue) children.push(await assoc.target.create({ ...childValue, [assoc.foreignKey]: parentPKValue }, childOptions));
      parent.setDataValue(alias, children);
      return;
    }

    if (nestedValue !== null && (typeof nestedValue !== 'object' || Array.isArray(nestedValue))) {
      throw new ModelError(`Nested update include "${alias}" must be an object or null for hasOne association`, {code: 'SEQ_NESTED_UPDATE_INVALID_VALUE', details: { model: this.modelName, include: alias, associationType: assoc.type }});
    }

    await assoc.target.destroy({ ...options, where: { [assoc.foreignKey]: parentPKValue } });
    if (nestedValue === null) {
      parent.setDataValue(alias, null);
      return;
    }
    const child = await assoc.target.create({ ...nestedValue, [assoc.foreignKey]: parentPKValue }, childOptions);
    parent.setDataValue(alias, child);
  }

  /**
   * Destroys records matching the where clause.
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<number>}
   */
  static async destroy(options = {}) {
    if (options.where !== undefined && (typeof options.where !== 'object' || Array.isArray(options.where)))throw new ValidationWhereError();
    //this._log('trace', `${this.modelName}.destroy`, options);
    if (options.hooks !== false) await this._runHooks('beforeDestroy', options);
    const result = await this._adapter.dml.delete(this, options);
    if (options.hooks !== false) await this._runHooks('afterDestroy', result, options);
    await this._invalidateCache(options);
    return result;
  }

  /**
   * Truncates all records in the table.
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<void>}
   */
  static async truncate(options = {}) {
    //this._log('trace', `${this.modelName}.truncate`);
    if (options.hooks !== false) await this._runHooks('beforeTruncate', options);
    const result = await this._adapter.dml.truncate(this, options);
    if (options.hooks !== false) await this._runHooks('afterTruncate', options);
    await this._invalidateCache(options);
    return result;
  }

  /**
   * Builds a new instance without persisting it.
   * @template {typeof Model} T
   * @this {T}
   * @param {object} values
   * @param {import('../../types/index.d.ts').BuildOptions} [options]
   * @returns {InstanceType<T>}
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
    const attr = this.constructor.rawAttributes?.[key];
    if (this.constructor._isVirtualAttribute(attr) && typeof attr.get === 'function') return attr.get.call(this);
    return this.dataValues[key];
  }

  /**
   * Sets the value of a data field.
   * @param {string} key
   * @param {*} value
   */
  setDataValue(key, value) {
    const attr = this.constructor.rawAttributes?.[key];
    if (this.constructor._isVirtualAttribute(attr) && typeof attr.set === 'function') {
      attr.set.call(this, value);
      this._changed[key] = true;
      return;
    }
    this.dataValues[key] = value;
    this._changed[key] = true;
  }

  /**
   * Returns a data field value or a plain object with all data values.
   * @param {string | { plain?: boolean }} [key]
   * @returns {TValues & Record<string, *>}
   */
  get(key) {
    if (typeof key === 'string') return this.getDataValue(key);

    const options = key && typeof key === 'object' ? key : {};
    const plain = options.plain === true;

    const values = clone(this.dataValues);
    const attrs = this.constructor.rawAttributes || {};
    for (const [attrKey, attr] of Object.entries(attrs)) {
      if (this.constructor._isVirtualAttribute(attr) && typeof attr.get === 'function') values[attrKey] = attr.get.call(this);
    }

    if (plain) return this.constructor._toPlainValue(values);
    return values;
  }

  /**
   * Returns a JSON-safe plain object.
   * @returns {TValues & Record<string, *>}
   */
  toJSON() {
    return this.get({ plain: true });
  }

  /**
   * Saves the instance (create or update).
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<this>}
   */
  async save(options = {}) {
    const Ctor = this.constructor;
    const isNew = this._isNew;
    if (options.hooks !== false) {
      await Ctor._runHooks('beforeSave', this, options);
      await Ctor._runHooks(isNew ? 'beforeCreate' : 'beforeUpdate', this, options);
    }

    if (this._isNew) {
      const result = await Ctor._adapter.dml.insert(Ctor, this.dataValues, options);
      Object.assign(this.dataValues, result.dataValues);
      this._isNew = false;
      this._changed = {};
      if (options.hooks !== false) {
        await Ctor._runHooks('afterCreate', this, options);
        await Ctor._runHooks('afterSave', this, options);
      }
      await Ctor._invalidateCache(options);
      return this;
    }
    const pk = Ctor.primaryKeyAttribute;
    if (!pk) throw new ModelError(`Model "${Ctor.modelName}" has no primary key`, { code: 'SEQ_MODEL_NO_PRIMARY_KEY' });
    const where = { [pk]: this.dataValues[pk] };
    const result = await Ctor._adapter.dml.update(Ctor, this.dataValues, { ...options, where });
    if (result && result.length > 0) Object.assign(this.dataValues, result[0].dataValues);
    this._changed = {};
    if (options.hooks !== false) {
      await Ctor._runHooks('afterUpdate', this, options);
      await Ctor._runHooks('afterSave', this, options);
    }
    await Ctor._invalidateCache(options);
    return this;
  }

  /**
   * Updates values and saves the instance.
   * @param {Partial<TValues>} values
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
   * @returns {Promise<this>}
   */
  async update(values, options = {}) {
    for (const [key, value] of Object.entries(values)) this.setDataValue(key, value);
    this._isNew = false;
    return this.save(options);
  }

  /**
   * Destroys this record.
   * @param {import('../../types/index.d.ts').MutationOptions} [options]
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

const measuredStaticOperations = [
  'create', 'bulkCreate', 'upsert', 'findByPk', 'findOrCreate', 'findOne',
  'findAll', 'count', 'findAndCountAll', 'update', 'destroy', 'truncate'
];

for (const operation of measuredStaticOperations) {
  const original = Model[operation];
  Object.defineProperty(Model, operation, {
    configurable: true,
    writable: true,
    value: function (...args) {
      return this._measureOperation(operation, () => original.apply(this, args));
    }
  });
}

const measuredInstanceOperations = ['save', 'update', 'destroy'];

for (const operation of measuredInstanceOperations) {
  const original = Model.prototype[operation];
  Object.defineProperty(Model.prototype, operation, {
    configurable: true,
    writable: true,
    value: function (...args) {
      return this.constructor._measureOperation(`instance.${operation}`, () => original.apply(this, args));
    }
  });
}

/**
 * Error thrown for configuration issues in Seq ORM.
 */
class ConfigurationError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConfigurationError';
    this.code = options.code || 'SEQ_CONFIGURATION_ERROR';
  }
}

class CacheAdapter {
  constructor(options = {}) {
    this.options = options;
    this._seq = null; // Will be injected by Cache if needed
  }

  /**
   * Gets a value from cache
   * @param {string} key
   * @returns {Promise<{ hit: boolean, value?: any }>}
   */
  async get(key) {
    throw new Error('Not implemented');
  }

  /**
   * Sets a value in cache
   * @param {string} key
   * @param {*} value
   * @param {string} modelName
   * @param {number} ttl
   * @returns {Promise<void>}
   */
  async set(key, value, modelName, ttl) {
    throw new Error('Not implemented');
  }

  /**
   * Deletes a specific key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    throw new Error('Not implemented');
  }

  /**
   * Invalidates all cache entries for a given model
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async invalidate(modelName) {
    throw new Error('Not implemented');
  }

  /**
   * Clears all cache
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('Not implemented');
  }
}

class MapCacheAdapter extends CacheAdapter {
  constructor(options = {}) {
    super(options);
    this._map = new Map();
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return { hit: false };
    if (Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  async set(key, value, modelName, ttl) {
    this._map.set(key, { value, expiresAt: Date.now() + ttl, model: modelName });
  }

  async delete(key) {
    this._map.delete(key);
  }

  async invalidate(modelName) {
    for (const [key, entry] of this._map.entries()) {
      if (entry.model === modelName) this._map.delete(key);
    }
  }

  async clear() {
    this._map.clear();
  }
}

/**
 * Creates a stable string representation of an object by sorting its keys.
 * @param {*} obj
 * @returns {string}
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  let result = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (obj[key] !== undefined) {
      result += JSON.stringify(key) + ':' + stableStringify(obj[key]);
      if (i < keys.length - 1) result += ',';
    }
  }
  if (result.endsWith(',')) result = result.slice(0, -1);
  result += '}';
  return result;
}

/**
 * Generates a deterministic hash for cache keys.
 * @param {string} modelName
 * @param {string} operation
 * @param {object} options
 * @returns {string}
 */
function generateCacheKey(modelName, operation, options = {}) {
  // Filter out options that don't affect the SQL result
  const { cache, transaction, hooks, _isNew, _partial, ...cacheableOptions } = options;
  const serializedOptions = stableStringify(cacheableOptions);
  //const hash = crypto.createHash('sha256').update(serializedOptions).digest('hex');
  const hash = crypto.createHash('md5').update(serializedOptions).digest('hex');
  return `seq:${modelName}:${operation}:${hash}`;
}

class Cache {
  constructor(options = {}) {
    this.options = options;
    this.globalTtl = options.ttl || 60 * 1000;

    if (options.adapter) {
      this.adapter = options.adapter;
    } else {
      this.adapter = new MapCacheAdapter(options);
    }
  }

  /**
   * Internal logging function delegating to Seq
   * @param {...*} args
   */
  _log(...args) {
    if (this.seq && typeof this.seq._log === 'function') {
      this.seq._log(...args);
    }
  }

  /**
   * Checks if cache is enabled for a specific model
   * @param {string} modelName
   * @returns {boolean}
   */
  isEnabled(modelName) {
    if (this.options[modelName] === false) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the TTL for a given model
   * @param {string} modelName
   * @returns {number}
   */
  _resolveTtl(modelName) {
    const modelOptions = this.options[modelName];
    if (modelOptions && typeof modelOptions === 'object' && modelOptions.ttl !== undefined) {
      return modelOptions.ttl;
    }
    return this.globalTtl;
  }

  /**
   * Gets a value from the cache
   * @param {string} modelName
   * @param {string} operation
   * @param {object} queryOptions
   * @returns {Promise<{ hit: boolean, value?: any }>}
   */
  async get(modelName, operation, queryOptions) {
    if (!this.isEnabled(modelName)) return { hit: false };
    const key = generateCacheKey(modelName, operation, queryOptions);
    const result = await this.adapter.get(key);
    this._log('trace', `Cache ${result.hit?'hit':'miss'}: ${key}, model: ${modelName}`);
    return result;
  }

  /**
   * Sets a value in the cache
   * @param {string} modelName
   * @param {string} operation
   * @param {object} queryOptions
   * @param {*} value
   * @returns {Promise<void>}
   */
  async set(modelName, operation, queryOptions, value) {
    if (!this.isEnabled(modelName)) return;
    const key = generateCacheKey(modelName, operation, queryOptions);
    const ttl = this._resolveTtl(modelName);
    await this.adapter.set(key, value, modelName, ttl);
  }

  /**
   * Invalidates the cache for a model
   * @param {string} modelName
   * @returns {Promise<void>}
   */
  async invalidate(modelName) {
    await this.adapter.invalidate(modelName);
  }

  /**
   * Clears all cache
   * @returns {Promise<void>}
   */
  async clear() {
    await this.adapter.clear();
  }
}

/**
 * Main Seq ORM class. Entry point for creating an ORM instance.
 */
class Seq {
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

/**
 * Converts a PascalCase or camelCase name to snake_case.
 * @param {string} name
 * @returns {string}
 */
function toSnakeCase(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Converts a snake_case or PascalCase name to camelCase.
 * @param {string} name
 * @returns {string}
 */
function toCamelCase(name) {
  return name
    .replace(/[-_]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/**
 * Converts the first character of a string to uppercase.
 * @param {string} name
 * @returns {string}
 */
function initCap(name) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Truncates a string to a maximum length while preserving both ends.
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
function truncateMiddle(name, maxLength) {
  const value = String(name);
  if (!maxLength || value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);

  const keep = maxLength - 1;
  const headLength = Math.ceil(keep / 2);
  const tailLength = Math.floor(keep / 2);
  return `${value.slice(0, headLength)}_${value.slice(value.length - tailLength)}`;
}

/**
 * Applies a naming convention to a name.
 * @param {string} name - The original name
 * @param {string} [convention] - 'camelCase' | 'snake_case' | undefined (no transform)
 * @returns {string}
 */
function applyConvention(name, convention) {
  if (!convention) return name;
  if (convention === 'snake_case') return toSnakeCase(name);
  if (convention === 'camelCase') return toCamelCase(name);
  return name;
}

/**
 * Applies the adapter's case style to a name.
 * @param {string} name - The name to transform
 * @param {string} [caseStyle] - 'upper' | 'lower' | undefined (no transform)
 * @returns {string}
 */
function applyCase(name, caseStyle) {
  if (!caseStyle) return name;
  if (caseStyle === 'upper') return name.toUpperCase();
  if (caseStyle === 'lower') return name.toLowerCase();
  return name;
}

/**
 * Base adapter class. All adapters must extend this.
 * Defines the contract for DDL, DML, DCL and TCL operations.
 */
class BaseAdapter {
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

class ErrorAbstract extends SeqError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ErrorAbstract';
    this.code = options.code || 'SEQ_ADAPTER_ERROR';
  }
}

/**
 * Error thrown for adapter-related issues in Seq ORM.
 */
class AdapterError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'AdapterError';
    this.code = options.code || 'SEQ_ADAPTER_ERROR';
  }
}

/**
 * Base class for abstract adapter groups.
 */
class BaseAbstract {
  constructor(adapter) {
    this._adapter = adapter;
  }

  _log(...args) {
    this._adapter?._log(...args);
  }

  _measureSql(sql, params = [], execute) {
    return this._adapter._measureSql(sql, params, execute);
  }
}

/**
 * Base DDL abstract.
 * Defines the full DDL contract and provides adapter-agnostic helpers.
 * Orchestrates createTable/alterTable in ordered phases.
 * Adapter-specific subclasses must implement the low-level methods.
 */
class DDLAbstract extends BaseAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _q(name) {
    return this._adapter._quoteIdentifier(name);
  }

  // ---------------------------------------------------------------------------
  // Orchestration — ordered DDL phases
  // ---------------------------------------------------------------------------

  /**
   * Creates a new table, processing constraints in order:
   * 1. CREATE TABLE (columns + PK)
   * 2. ADD UNIQUE constraints
   * 3. CREATE INDEX
   * 4. ADD FOREIGN KEY
   * @param {object} definition - Table definition
   * @param {object} [options]
   */
  async createTable(definition, options = {}) {
    const def = this.normalizeDefinition(definition);
    const previousSchema = this._adapter.schemas.get(def.tableName);
    let structureCreated = false;
    this._registerSchema(def);
    try {
      await this.createTableStructure(def);
      structureCreated = true;
      for (const uk of def.uniqueConstraints) await this.addUniqueConstraint(def.tableName, uk);
      for (const idx of def.indexes) await this.addIndex(def.tableName, idx);
      for (const fk of def.foreignKeys) await this.addForeignKey(def.tableName, fk);
    } catch (error) {
      if (previousSchema) this._adapter.schemas.set(def.tableName, previousSchema);
      else this._adapter.schemas.delete(def.tableName);
      if (structureCreated) {
        try {
          await this.dropTable(def.tableName, { ifExists: true, ignoreForeignKeys: true });
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
        }
      }
      throw error;
    }
  }

  /**
   * Alters a table to match a new definition.
   * Adds missing columns, unique constraints, indexes, and foreign keys.
   * @param {string} tableName
   * @param {object} definition - New table definition
   * @param {object} [options]
   * @returns {Promise<boolean>} Whether any changes were made
   */
  async alterTable(tableName, definition, options = {}) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, {code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'});

    const def = this.normalizeDefinition(definition);
    let hasChanges = false;

    const missing = this.diffColumns(schema, def);
    if (Object.keys(missing).length > 0) {
      await this.addColumns(tableName, missing);
      hasChanges = true;
    }

    const existingUKNames = new Set(schema.uniqueConstraints.map(uk => uk.constraintName));
    for (const uk of def.uniqueConstraints) {
      if (!existingUKNames.has(uk.constraintName)) {
        await this.addUniqueConstraint(tableName, uk);
        hasChanges = true;
      }
    }

    const existingIdxNames = new Set(schema.indexes.map(idx => idx.name));
    for (const idx of def.indexes) {
      if (!existingIdxNames.has(idx.name)) {
        await this.addIndex(tableName, idx);
        hasChanges = true;
      }
    }

    const existingFKNames = new Set(schema.foreignKeys.map(fk => fk.constraintName));
    for (const fk of def.foreignKeys) {
      if (!existingFKNames.has(fk.constraintName)) {
        await this.addForeignKey(tableName, fk);
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Creates the base table structure (columns + primary key).
   * Does not add constraints — those are handled by createTable orchestration.
   * @param {object} def - Normalized definition
   */
  async createTableStructure(def) {
    throw new AdapterError('DDL createTableStructure is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Drops a table and removes its schema from the registry.
   * @param {string} tableName
   * @param {object} [options]
   */
  async dropTable(tableName, options = {}) {
    //this._log('trace', 'DDL.dropTable', tableName);
    this._adapter.schemas.delete(tableName);
  }

  /**
   * Removes all data from a table without removing its schema.
   * Adapters can use this as a pre-drop cleanup step for physical databases.
   * @param {string} tableName
   * @param {object} [options]
   */
  async truncateTable(tableName, options = {}) {
    throw new AdapterError('DDL truncateTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Checks if a table exists.
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async hasTable(tableName) {
    throw new AdapterError('DDL hasTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Describes a table's schema.
   * @param {string} tableName
   * @returns {Promise<object>}
   */
  async describeTable(tableName) {
    throw new AdapterError('DDL describeTable is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Lists all table names.
   * @returns {Promise<string[]>}
   */
  async listTables() {
    throw new AdapterError('DDL listTables is not implemented by this adapter', { code: 'SEQ_DDL_NOT_IMPLEMENTED' });
  }

  /**
   * Adds missing columns to an existing table.
   * Executes ALTER TABLE ADD COLUMN for each missing column.
   * @param {string} tableName
   * @param {object} missingColumns - Map of column names to definitions
   */
  async addColumns(tableName, missingColumns) {
    //this._log('DDL.addColumns', tableName, Object.keys(missingColumns));
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      const colType = this._adapter.mapDataType(colDef.type);
      const columnName = colDef.field || name;
      const constraints = [];
      if (!colDef.allowNull && colDef.defaultValue === undefined) {
        throw new AdapterError(`Cannot add required column "${name}" without a default value`, {
          code: 'SEQ_DDL_REQUIRED_COLUMN_NEEDS_DEFAULT', details: { tableName, field: name }
        });
      }
      if (!colDef.allowNull) constraints.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null) {
        const value = typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue;
        constraints.push(`DEFAULT ${this._formatDefaultValue(value)}`);
      }
      const sql = `ALTER TABLE ${this._q(tableName)} ADD COLUMN ${this._q(columnName)} ${colType}${constraints.length ? ` ${constraints.join(' ')}` : ''}`;
      this._measureSql(sql, [], () => this._adapter._db.prepare(sql).run());
      schema.columns[name] = colDef;
      schema.attrToColumn[name] = columnName;
      schema.columnToAttr[columnName] = name;
    }
  }

  _formatDefaultValue(value) {
    if (value === null) return 'NULL';
    if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    }
    throw new AdapterError('Unsupported default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }

  /**
   * Adds a UNIQUE constraint to a table via CREATE UNIQUE INDEX.
   * @param {string} tableName
   * @param {object} constraint - { columns: string[], constraintName: string }
   */
  async addUniqueConstraint(tableName, constraint) {
    //this._log('DDL.addUniqueConstraint', tableName, constraint.constraintName);
    const schema = this._adapter.schemas.get(tableName);
    const cols = constraint.columns.map(c => this._q(c)).join(', ');
    const sql = `CREATE UNIQUE INDEX ${this._q(constraint.constraintName)} ON ${this._q(tableName)} (${cols})`;
    this._measureSql(sql, [], () => this._adapter._db.prepare(sql).run());
    schema.uniqueConstraints.push({ ...constraint });
  }

  /**
   * Creates an index on a table.
   * @param {string} tableName
   * @param {object} index - { columns: string[], name: string, unique: boolean }
   */
  async addIndex(tableName, index) {
    //this._log('DDL.addIndex', tableName, index.name);
    const schema = this._adapter.schemas.get(tableName);
    const cols = index.columns.map(c => this._q(c)).join(', ');
    const unique = index.unique ? 'UNIQUE ' : '';
    const sql = `CREATE ${unique}INDEX ${this._q(index.name)} ON ${this._q(tableName)} (${cols})`;
    this._measureSql(sql, [], () => this._adapter._db.prepare(sql).run());
    schema.indexes.push({ ...index });
  }

  /**
   * Adds a foreign key constraint to a table's schema.
   * @param {string} tableName
   * @param {object} fk - Foreign key definition
   */
  async addForeignKey(tableName, fk) {
    //this._log('DDL.addForeignKey', tableName, fk.constraintName);
    if (this._adapter.fkStrategy === 'alter'){
      const sql = `ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(fk.constraintName)} FOREIGN KEY (${this._q(fk.columnName)}) REFERENCES ${this._q(fk.references.table)} (${this._q(fk.references.column)}) ON DELETE ${fk.onDelete || 'RESTRICT'} ON UPDATE ${fk.onUpdate || 'RESTRICT'}`;
      this._measureSql(sql, [], () => this._adapter._db.prepare(sql).run());
    }
    const schema = this._adapter.schemas.get(tableName);
    schema.foreignKeys.push({ ...fk });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Registers a table schema in the adapter's schema registry.
   * @param {object} def - Normalized definition
   * @param {object} [options]
   * @param {boolean} [options.preserveConstraints=false] - Keep constraints already present in the definition.
   */
  _registerSchema(def, options = {}) {
    const {columns = {}, virtualAttributes = {}, attrToColumn = {}, columnToAttr = {}} = def;
    const [uniqueConstraints, indexes, foreignKeys] = options.preserveConstraints?[def.uniqueConstraints, def.indexes, def.foreignKeys]:[[], [], []];
    this._adapter.schemas.set(def.tableName, {...def, columns, uniqueConstraints, indexes, foreignKeys, virtualAttributes, attrToColumn, columnToAttr});
  }

  /**
   * Normalizes a table definition, filling in defaults for optional fields.
   * @param {object} definition
   * @returns {object} Normalized definition
   */
  normalizeDefinition(definition) {
    return {
      modelName: definition.modelName || null,
      tableName: definition.tableName,
      columns: { ...(definition.columns || {}) },
      uniqueConstraints: [...(definition.uniqueConstraints || [])],
      indexes: [...(definition.indexes || [])],
      foreignKeys: [...(definition.foreignKeys || [])],
      primaryKey: definition.primaryKey || null,
      autoIncrement: definition.autoIncrement || null,
      primaryKeyAttribute: definition.primaryKeyAttribute || null,
      autoIncrementAttribute: definition.autoIncrementAttribute || null,
      timestamps: definition.timestamps || false,
      createdAt: definition.createdAt || 'createdAt',
      updatedAt: definition.updatedAt || 'updatedAt',
      virtualAttributes: [...(definition.virtualAttributes || [])],
      attrToColumn: definition.attrToColumn || {},
      columnToAttr: definition.columnToAttr || {}
    };
  }

  /**
   * Returns columns present in newDefinition but missing from existingSchema.
   * @param {object} existingSchema - Current schema stored by the adapter
   * @param {object} newDefinition - New table definition
   * @returns {object} Map of missing column names to their definitions
   */
  diffColumns(existingSchema, newDefinition) {
    const missing = {};
    const newColumns = newDefinition.columns || {};

    for (const [name, colDef] of Object.entries(newColumns)) {
      if (!(name in existingSchema.columns)) {
        missing[name] = colDef;
      }
    }

    return missing;
  }
}

/**
 * DDL operations for the MapAdapter.
 * Implements low-level table operations; orchestration lives in DDLAbstract.
 */
class MapDDL extends DDLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  // ---------------------------------------------------------------------------
  // Low-level implementations — called by DDLAbstract orchestration
  // ---------------------------------------------------------------------------

  async createTableStructure(def) {
    if (this._adapter.database.has(def.tableName))  throw new AdapterError(`Table "${def.tableName}" already exists`, { code: 'SEQ_ADAPTER_TABLE_EXISTS'});

    this._adapter.database.set(def.tableName, new Map());
    this._adapter.sequences.set(def.tableName, 1);
  }

  async dropTable(tableName, options = {}) {
    if (!this._adapter.database.has(tableName)) throw new AdapterError(`Table "${tableName}" does not exist`, {code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'});
    await this.truncateTable(tableName, options);
    await super.dropTable(tableName, options);
    this._adapter.database.delete(tableName);
    this._adapter.sequences.delete(tableName);
  }

  async truncateTable(tableName, options = {}) {
    const table = this._adapter.database.get(tableName);
    if (!table) {
      if (options.ifExists) return;
      throw new AdapterError(`Table "${tableName}" does not exist`, {code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'});
    }
    table.clear();
    this._adapter.sequences.set(tableName, 1);
  }

  async hasTable(tableName) {
    return this._adapter.database.has(tableName);
  }

  async describeTable(tableName) {
    if (!this._adapter.schemas.has(tableName))  throw new AdapterError(`Table "${tableName}" does not exist`, {code: 'SEQ_ADAPTER_TABLE_NOT_FOUND'});
    return { ...this._adapter.schemas.get(tableName) };
  }

  async addColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      schema.columns[name] = colDef;
      const columnName = colDef.field || name;
      schema.attrToColumn[name] = columnName;
      schema.columnToAttr[columnName] = name;
    }
    const table = this._adapter.database.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      const columnName = colDef.field || name;
      for (const [, record] of table) {
        if (!(columnName in record)) {
          record[columnName] = colDef.defaultValue !== undefined
            ? (typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue)
            : null;
        }
      }
    }
  }

  async listTables() {
    return [...this._adapter.database.keys()];
  }

  async addUniqueConstraint(tableName, constraint) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    schema.uniqueConstraints.push({ ...constraint });
  }

  async addIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    if (!schema) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    schema.indexes.push({ ...index });
  }
}

/**
 * Resolves a where clause value into { op, value }.
 * Scalar values → Op.eq.
 * Objects with a single Symbol key → that operator.
 * @param {*} value
 * @returns {{ op: symbol, value: * }}
 */
function resolveWhereValue(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length === 1) {
      return { op: symbols[0], value: value[symbols[0]] };
    }
  }
  return { op: Op.eq, value };
}

/**
 * Base DML abstract.
 * Provides SQL-based default implementations for selectAll, count, update, delete.
 * Adapter subclasses implement execution hooks (_executeQuery, _executeGet, _execute, _mapRows)
 * and adapter-specific methods (insert, truncate).
 */
class DMLAbstract extends BaseAbstract {
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

  _tableWithAlias(tableName, alias) {
    return `${this._q(tableName)}${alias ? ` AS ${this._q(alias)}` : ''}`;
  }

  _applyLimitOffset(sql, options) {
    return sql + this._buildLimitOffset(options);
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

  _attributesWithRequired(attributes, required) {
    if (!Array.isArray(attributes) || attributes.length === 0 || required.length === 0) return attributes;
    return [...new Set([...attributes, ...required])];
  }

  _requiredSourceAttributesForLazyIncludes(model, includes) {
    const required = [];
    const pkAttr = model.primaryKeyAttribute || 'id';
    for (const inc of includes || []) {
      if (!inc.model) continue;
      const assoc = resolveAssociation(model, inc);
      if (!assoc) continue;
      if (assoc.type === 'belongsTo') {
        required.push(assoc.foreignKey);
      } else {
        required.push(pkAttr);
      }
    }
    return [...new Set(required)];
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
  _buildQualifiedSelect(model, schema, alias, includes, includeSqlAliases = buildIncludeSqlAliasMap(includes, model, this), globalEager = false) {
    const parts = [];
    const aliasPrefix = alias || this._getTableName(model);
    for (const [attrName, colDef] of Object.entries(schema.columns || {})) {
      const colName = schema.attrToColumn[attrName] || attrName;
      parts.push(`${this._colRef(colName, alias)} AS ${this._q(`${aliasPrefix}.${attrName}`)}`);
    }
    this._addQualifiedIncludeSelects(parts, includes, includeSqlAliases, globalEager);
    return parts.join(', ');
  }

  _addQualifiedIncludeSelects(parts, includes, includeSqlAliases, globalEager) {
    for (const inc of includes) {
      if (!inc.model) continue;
      const { schema: incSchema } = this._schema(inc.model);
      const incAliasPrefix = includeSqlAliases.get(inc) || this._getTableName(inc.model);
      const selected = Array.isArray(inc.attributes) && inc.attributes.length > 0
        ? new Set([...inc.attributes, inc.model.primaryKeyAttribute || 'id'])
        : null;
      for (const [attrName, colDef] of Object.entries(incSchema.columns || {})) {
        if (selected && !selected.has(attrName)) continue;
        const colName = incSchema.attrToColumn[attrName] || attrName;
        parts.push(`${this._colRef(colName, incAliasPrefix)} AS ${this._q(`${incAliasPrefix}.${attrName}`)}`);
      }
      this._addQualifiedIncludeSelects(parts, eagerNestedIncludes(inc, globalEager), includeSqlAliases, globalEager);
    }
  }

  /**
   * Builds LEFT JOIN clauses for includes.
   * @param {object[]} includes - Normalized include descriptors (eager only)
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {string|null} parentAlias
   * @param {function} resolveIncludeAliasFn - resolveIncludeAlias function
   * @returns {{ sql: string, params: *[] }}
   */
  _buildJoinClause(includes, model, parentAlias, resolveIncludeAliasFn, includeSqlAliases = buildIncludeSqlAliasMap(includes, model, this), globalEager = false) {
    let sql = '';
    const params = [];
    const { schema: parentSchema } = this._schema(model);
    for (const inc of includes) {
      if (!inc.model) continue;
      const assoc = resolveAssociation(model, inc);
      if (!assoc) continue;
      const { tableName: targetTable, schema: targetSchema } = this._schema(inc.model);
      const joinAlias = includeSqlAliases.get(inc) || targetTable;
      const joinType = inc.required ? 'INNER JOIN' : 'LEFT JOIN';
      const fkAttr = assoc.foreignKey;

      if (assoc.type === 'belongsToMany') {
        const throughTable = this._adapter.getAssociationThroughTable(assoc);
        const junctionSchema = this._adapter.schemas.get(throughTable);
        if (!junctionSchema) continue;
        const junctionAlias = throughTable;
        const junctionFKCol = junctionSchema.attrToColumn[fkAttr] || fkAttr;
        const junctionOtherKeyCol = junctionSchema.attrToColumn[assoc.otherKey] || assoc.otherKey;
        const pkAttr = model.primaryKeyAttribute || 'id';
        const pkCol = parentSchema.attrToColumn[pkAttr] || pkAttr;
        const targetPKAttr = assoc.target.primaryKeyAttribute || 'id';
        const targetPKCol = targetSchema.attrToColumn[targetPKAttr] || targetPKAttr;

        sql += ` ${joinType} ${this._tableWithAlias(throughTable, junctionAlias)} ON ${this._colRef(pkCol, parentAlias)} = ${this._colRef(junctionFKCol, junctionAlias)}`;

        let onClause = `${this._colRef(junctionOtherKeyCol, junctionAlias)} = ${this._colRef(targetPKCol, joinAlias)}`;
        if (inc.where) {
          const where = this._buildConditions(inc.where, targetSchema, joinAlias);
          onClause += ` AND ${where.conditions.join(' AND ')}`;
          params.push(...where.params);
        }
        sql += ` ${joinType} ${this._tableWithAlias(targetTable, joinAlias)} ON ${onClause}`;
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
        sql += ` ${joinType} ${this._tableWithAlias(targetTable, joinAlias)} ON ${onClause}`;
      }
      const nested = this._buildJoinClause(eagerNestedIncludes(inc, globalEager), inc.model, joinAlias, resolveIncludeAliasFn, includeSqlAliases, globalEager);
      sql += nested.sql;
      params.push(...nested.params);
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

  async selectAssociationJunctionRows(assoc, sourceIds, options = {}) {
    this._assertTransaction(options);
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) return [];

    const fkAttr = assoc.foreignKey;
    const otherKeyAttr = assoc.otherKey;

    if (assoc.throughModel) {
      const rows = await Promise.all(chunks(sourceIds).map(ids => {
        return this.selectAll(assoc.throughModel, {
          where: { [fkAttr]: { [Op.in]: ids } },
          attributes: [fkAttr, otherKeyAttr],
          transaction: options.transaction
        });
      }));
      return rows.flat().map(row => ({
        [fkAttr]: row.getDataValue(fkAttr),
        [otherKeyAttr]: row.getDataValue(otherKeyAttr)
      }));
    }

    const throughTable = this._adapter.getAssociationThroughTable(assoc);
    const junctionSchema = this._adapter.schemas.get(throughTable);
    if (!junctionSchema) {
      throw new AdapterError(`Table "${throughTable}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }

    const fkCol = junctionSchema.attrToColumn[fkAttr] || fkAttr;
    const otherKeyCol = junctionSchema.attrToColumn[otherKeyAttr] || otherKeyAttr;
    const rows = await Promise.all(chunks(sourceIds).map(ids => {
      const placeholders = ids.map(() => '?').join(', ');
      const sql = `SELECT ${this._q(fkCol)} AS ${this._q(fkAttr)}, ${this._q(otherKeyCol)} AS ${this._q(otherKeyAttr)} FROM ${this._q(throughTable)} WHERE ${this._q(fkCol)} IN (${placeholders})`;
      return this._executeQueryAll(sql, ids.map(id => this._serializeValue(id)));
    }));
    return rows.flat();
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
    const requestedAttributes = Array.isArray(queryOptions.attributes) && queryOptions.attributes.length > 0
      ? queryOptions.attributes
      : null;
    const requiredLazyAttributes = requestedAttributes
      ? this._requiredSourceAttributesForLazyIncludes(model, lazyIncludes)
      : [];
    if (requestedAttributes && requiredLazyAttributes.length > 0) {
      queryOptions = {
        ...queryOptions,
        attributes: this._attributesWithRequired(requestedAttributes, requiredLazyAttributes)
      };
    }
    let sql;
    const params = [];
    let eagerIncludeSqlAliases = null;
    if (eagerIncludes.length > 0) {
      eagerIncludeSqlAliases = buildIncludeSqlAliasMap(eagerIncludes, model, this, globalEager);
      const qualifiedSelect = this._buildQualifiedSelect(model, schema, alias, eagerIncludes, eagerIncludeSqlAliases, globalEager);
      sql = `SELECT ${qualifiedSelect} FROM ${this._tableWithAlias(tableName, alias)}`;
      const joins = this._buildJoinClause(eagerIncludes, model, alias, resolveIncludeAlias, eagerIncludeSqlAliases, globalEager);
      sql += joins.sql;
      params.push(...joins.params);
    } else {
      const selectList = this._buildSelectList(queryOptions.attributes, schema, alias);
      sql = `SELECT ${selectList} FROM ${this._tableWithAlias(tableName, alias)}`;
    }
    const where = this._buildWhere(queryOptions.where, schema, alias);
    sql += where.sql;
    params.push(...where.params);
    sql += this._buildOrderBy(queryOptions.order, schema, alias);
    sql = this._applyLimitOffset(sql, queryOptions);
    const rows = await this._executeQueryAll(sql, params);
    let instances;
    if (eagerIncludes.length > 0) {
      instances = processJoinedRows(rows, model, eagerIncludes, this, eagerIncludeSqlAliases, globalEager);
      instances = await loadNestedLazyIncludes(instances, eagerIncludes, model, this, queryOptions);
    } else {
      instances = this._mapRows(rows, model, schema, queryOptions);
    }
    if (lazyIncludes.length > 0) {
      instances = await loadIncludes(instances, lazyIncludes, model, this, queryOptions);
    }
    if (requestedAttributes && requiredLazyAttributes.length > 0) {
      trimProjection(instances, requestedAttributes, includes, model);
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
    let sql = `SELECT COUNT(*) as cnt FROM ${this._tableWithAlias(tableName, alias)}`;
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
   * Creates a record or updates the one matched by where, conflictFields, or primary key.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} values - Values using attribute names
   * @param {object} [options]
   * @returns {Promise<[import('../../core/Model.js').Model, boolean]>}
   */
  async upsert(model, values, options = {}) {
    this._assertTransaction(options);
    const { schema } = this._schema(model);
    const where = this._resolveUpsertWhere(model, values, options, schema);
    const existing = await this.selectOne(model, { where, transaction: options.transaction });

    if (existing) {
      const pkAttr = schema.primaryKeyAttribute;
      const updateWhere = pkAttr ? { [pkAttr]: existing.getDataValue(pkAttr) } : where;
      const updated = await this.update(model, values, { ...options, where: updateWhere });
      return [updated[0] || existing, false];
    }

    const created = await this.insert(model, values, options);
    return [created, true];
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
   * Selects one record matching the where clause.
   * @param {typeof import('../../core/Model.js').Model} model
   * @param {object} [options]
   * @returns {Promise<import('../../core/Model.js').Model|null>}
   */
  async selectOne(model, options = {}) {
    const results = await this.selectAll(model, { ...options, limit: 1, offset: 0 });
    return results.length > 0 ? results[0] : null;
  }

  _resolveUpsertWhere(model, values, options = {}, schema = null) {
    if (options.where) return options.where;
    const upsertSchema = schema || this._schema(model).schema;
    const fields = this._resolveUpsertConflictFields(model, values, options, upsertSchema);
    if (fields.length === 0) {
      throw new ValidationError(`Model "${model.modelName}" upsert requires options.where, options.conflictFields, or a primary key value`, {
        code: 'SEQ_VALIDATION_UPSERT_TARGET',
        details: { model: model.modelName }
      });
    }
    return Object.fromEntries(fields.map(field => [field, values[field]]));
  }

  _resolveUpsertConflictFields(model, values, options = {}, schema = null) {
    const upsertSchema = schema || this._schema(model).schema;
    if (options.conflictFields !== undefined) {
      if (!Array.isArray(options.conflictFields) || options.conflictFields.length === 0) {
        throw new ValidationError('conflictFields must be a non-empty array', { code: 'SEQ_VALIDATION_UPSERT_TARGET' });
      }
      for (const field of options.conflictFields) {
        if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(upsertSchema.attrToColumn, field)) {
          throw new ValidationError(`Unknown conflict field "${field}"`, {
            code: 'SEQ_VALIDATION_UNKNOWN_ATTRIBUTE',
            details: { field, model: model.modelName }
          });
        }
        if (values[field] === undefined || values[field] === null) {
          throw new ValidationError(`Upsert conflict field "${field}" must have a value`, {
            code: 'SEQ_VALIDATION_UPSERT_TARGET',
            details: { field, model: model.modelName }
          });
        }
      }
      return [...options.conflictFields];
    }

    const pkAttr = upsertSchema.primaryKeyAttribute;
    if (pkAttr && values[pkAttr] !== undefined && values[pkAttr] !== null) return [pkAttr];

    for (const unique of upsertSchema.uniqueConstraints || []) {
      const fields = unique.columns.map(column => upsertSchema.columnToAttr[column] || column);
      if (fields.every(field => values[field] !== undefined && values[field] !== null)) return fields;
    }

    return [];
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
class MapDML extends DMLAbstract {
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

    if (schema.primaryKey) {
      const pkValue = colRecord[schema.primaryKey];
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
    if (schema.primaryKey) {
      table.set(colRecord[schema.primaryKey], storedRecord);
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
    let instances = await this._select(model, options);
    if (options.include?.length) instances = await loadIncludes(instances, options.include, model, this, options);
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
    const rows = [];

    for (const [, record] of table) {
      if (!sourceSet.has(record[fkCol])) continue;
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
      for (const [colName, value] of Object.entries(colValues)) {
        record[colName] = value;
      }

      if (schema?.timestamps && schema.updatedAt) {
        const updatedCol = schema.attrToColumn[schema.updatedAt] || schema.updatedAt;
        record[updatedCol] = now;
      }

      const newKey = schema.primaryKey ? record[schema.primaryKey] : key;
      if (newKey !== key && table.has(newKey)) {
        throw new ValidationError(`Duplicate primary key value "${newKey}" for model "${model.modelName}"`, {
          code: 'SEQ_VALIDATION_DUPLICATE_PK'
        });
      }
      this._checkUniqueConstraint(tableName, schema, record, key);
      this._checkForeignKeyConstraint(schema, record);
      this._handleCascadeOnUpdate(model, schema, record, key);

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
        const deletedPkValue = schema.primaryKey ? record[schema.primaryKey] : key;
        this._handleCascadeOnDelete(model, schema, deletedPkValue);
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

  _checkForeignKeyConstraint(schema, colRecord) {
    const foreignKeys = schema.foreignKeys || [];
    for (const fk of foreignKeys) {
      const value = colRecord[fk.columnName];
      if (value === null || value === undefined) continue;

      const refTable = this._adapter.database.get(fk.references.table);
      if (!refTable) continue;

      this._adapter.schemas.get(fk.references.table);
      const refPkCol = fk.references.column;
      let found = false;
      for (const [, existing] of refTable) {
        if (existing[refPkCol] === value) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new ValidationError(
          `Foreign key constraint "${fk.constraintName}": value "${value}" for "${fk.attributeName}" does not exist in "${fk.references.model}.${fk.references.key}"`,
          {
            code: 'SEQ_VALIDATION_FK',
            details: { model: schema.modelName, field: fk.attributeName, value, constraintName: fk.constraintName, referencesModel: fk.references.model, referencesKey: fk.references.key }
          }
        );
      }
    }
  }

  _handleCascadeOnDelete(model, schema, deletedPkValue) {
    const fkTableName = this._getTableName(model);
    for (const otherTableName of this._adapter.database.keys()) {
      if (otherTableName === fkTableName) continue;
      const otherSchema = this._adapter.schemas.get(otherTableName);
      if (!otherSchema) continue;
      const otherTable = this._adapter.database.get(otherTableName);

      for (const fk of (otherSchema.foreignKeys || [])) {
        if (fk.references.table !== fkTableName) continue;

        const pkCol = schema.primaryKey;
        if (!pkCol) continue;

        for (const [pk, record] of otherTable) {
          if (record[fk.columnName] === deletedPkValue) {
            if (fk.onDelete === 'CASCADE') {
              otherTable.delete(pk);
            } else if (fk.onDelete === 'SET NULL') {
              record[fk.columnName] = null;
            } else {
              throw new ValidationError(
                `Cannot delete: record is referenced by "${otherSchema.modelName}" via constraint "${fk.constraintName}" on "${fk.attributeName}"`,
                { code: 'SEQ_VALIDATION_FK_RESTRICT', details: { model: otherSchema.modelName, field: fk.attributeName, constraintName: fk.constraintName } }
              );
            }
          }
        }
      }
    }
  }

  _handleCascadeOnUpdate(model, schema, record, pkValue) {
    const pkCol = schema.primaryKey;
    if (!pkCol) return;

    const oldPkValue = pkValue;
    const newPkValue = record[pkCol];
    if (oldPkValue === newPkValue) return;

    const tableName = this._getTableName(model);
    for (const otherTableName of this._adapter.database.keys()) {
      if (otherTableName === tableName) continue;
      const otherSchema = this._adapter.schemas.get(otherTableName);
      if (!otherSchema) continue;
      const otherTable = this._adapter.database.get(otherTableName);

      for (const fk of (otherSchema.foreignKeys || [])) {
        if (fk.references.table !== tableName) continue;

        for (const [, otherRecord] of otherTable) {
          if (otherRecord[fk.columnName] === oldPkValue) {
            if (fk.onUpdate === 'CASCADE') {
              otherRecord[fk.columnName] = newPkValue;
            } else if (fk.onUpdate === 'SET NULL') {
              otherRecord[fk.columnName] = null;
            } else {
              throw new ValidationError(
                `Cannot update: record is referenced by "${otherSchema.modelName}" via constraint "${fk.constraintName}" on "${fk.attributeName}"`,
                { code: 'SEQ_VALIDATION_FK_RESTRICT', details: { model: otherSchema.modelName, field: fk.attributeName, constraintName: fk.constraintName } }
              );
            }
          }
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

/**
 * Base DCL abstract.
 * Provides a default "not supported" implementation for adapters that don't support DCL.
 * Subclasses can override grant/revoke with real implementations.
 */
class DCLAbstract extends BaseAbstract {
  /**
   * Grant privileges. Throws not supported by default.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async grant(...args) {
    throw new AdapterError('DCL grant is not supported by this adapter',{ code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' });
  }

  /**
   * Revoke privileges. Throws not supported by default.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async revoke(...args) {
    throw new AdapterError( 'DCL revoke is not supported by this adapter', { code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' } );
  }
}

/**
 * DCL operations for the MapAdapter.
 * In-memory adapter does not support DCL — inherits default "not supported" from DCLAbstract.
 */
class MapDCL extends DCLAbstract {
  constructor(adapter) {
    super(adapter);
  }
}

/**
 * Base TCL abstract.
 * Defines the full TCL contract and provides adapter-agnostic helpers.
 * Adapter-specific subclasses must override all public methods.
 */
class TCLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Begins a new transaction.
   * @param {object} [options]
   * @returns {Promise<object>} Transaction object
   */
  async begin(options = {}) {
    throw new AdapterError('TCL begin is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  /**
   * Commits a transaction.
   * @param {object} transaction
   */
  async commit(transaction) {
    throw new AdapterError('TCL commit is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  /**
   * Rolls back a transaction.
   * @param {object} transaction
   */
  async rollback(transaction) {
    throw new AdapterError('TCL rollback is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Validates that a transaction object is active.
   * @param {object} transaction
   * @throws {AdapterError} If transaction is not active or missing
   */
  _validateTransaction(transaction) {
    if (!transaction || !transaction.active || transaction.adapter !== this._adapter || this._adapter._activeTransaction !== transaction) {
      throw new AdapterError('Transaction is not active or already finished', {
        code: 'SEQ_ADAPTER_TRANSACTION_INVALID'
      });
    }
  }
}

/**
 * Transaction ID counter.
 */
let transactionIdCounter$2 = 0;

/**
 * TCL operations for the MapAdapter.
 *
 * Extends TCLStatements which provides _validateTransaction.
 *
 * Transaction strategy:
 * - begin: snapshot all main tables and sequences
 * - commit: discard snapshots (changes already in main tables)
 * - rollback: restore main tables and sequences from snapshots
 *
 * DML operations always write directly to the main tables.
 * This is a simple optimistic approach suitable for an in-memory adapter.
 */
class MapTCL extends TCLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  /**
   * Begins a new transaction.
   * Creates snapshots of all tables and sequences for potential rollback.
   * @param {object} [options]
   * @returns {Promise<object>} Transaction object
   */
  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent Map transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    }
    const transaction = {
      id: ++transactionIdCounter$2,
      active: true,
      adapter: this._adapter,
      baseDatabase: this._adapter.database,
      baseSequences: this._adapter.sequences
    };
    this._adapter.database = this._cloneDatabase(this._adapter.database);
    this._adapter.sequences = new Map(this._adapter.sequences);
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  /**
   * Commits a transaction.
   * Discards snapshots; changes are already applied to the main tables.
   * @param {object} transaction
   */
  async commit(transaction) {
    this._validateTransaction(transaction);
    transaction.active = false;
    transaction.baseDatabase = null;
    transaction.baseSequences = null;
    this._adapter._activeTransaction = null;
  }

  /**
   * Rolls back a transaction.
   * Restores the database from snapshots taken at begin.
   * @param {object} transaction
   */
  async rollback(transaction) {
    this._validateTransaction(transaction);

    this._adapter.database = transaction.baseDatabase;
    this._adapter.sequences = transaction.baseSequences;
    transaction.active = false;
    transaction.baseDatabase = null;
    transaction.baseSequences = null;
    this._adapter._activeTransaction = null;
  }

  _cloneDatabase(database) {
    const result = new Map();
    for (const [tableName, table] of database) {
      result.set(tableName, new Map([...table].map(([key, record]) => [key, clone(record)])));
    }
    return result;
  }
}

/**
 * In-memory adapter using Map collections.
 * Structure: Map<tableName, Map<primaryKey, record>>
 */
class MapAdapter extends BaseAdapter {
  static defaultNaming = {
    tables: 'camelCase',
    columns: 'camelCase',
    prefix: undefined,
    caseStyle: 'lower'
  };

  constructor(options = {}) {
    super({ fkStrategy: 'none', ...options });
    /** @type {Map<string, Map<*|null, object>>} */
    this.database = new Map();
    /** @type {Map<string, number>} */
    this.sequences = new Map();

    this.ddl = new MapDDL(this);
    this.dml = new MapDML(this);
    this.dcl = new MapDCL(this);
    this.tcl = new MapTCL(this);
  }

  /**
   * Initializes the adapter (no-op for in-memory).
   */
  async initialize() {}

  /**
   * Returns metadata about the virtual database.
   * @returns {Promise<object>}
   */
  async inspectDatabase() {
    return {
      tables: [...this.schemas.keys()],
      schemas: Object.fromEntries(this.schemas),
      recordCounts: Object.fromEntries(
        [...this.database.entries()].map(([name, table]) => [name, table.size])
      )
    };
  }

  /**
   * Maps an abstract DataType to a string representation.
   * @param {import('../../data-types/AbstractDataType.js').AbstractDataType} dataType
   * @returns {string}
   */
  mapDataType(dataType) {
    return dataType.toString();
  }

  /**
   * Clones a record for safe external access.
   * @param {object} record
   * @returns {object}
   */
  cloneRecord(record) {
    return clone(record);
  }
}

class SQLiteDDL extends DDLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async _execute(sql, params = []) {
    return this._measureSql(sql.replaceAll('\n  ', ' '), params, () => this._db().prepare(sql).run(...params));
  }

  async createTableStructure(def) {
    const colDefs = [];
    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const colName = colDef.field || attrName;
      const parts = [this._q(colName)];
      parts.push(this._adapter.mapDataType(colDef.type));
      if (colDef.primaryKey && !def.autoIncrement) parts.push('PRIMARY KEY');
      if (colDef.autoIncrement) parts.push('PRIMARY KEY AUTOINCREMENT');
      if (!colDef.allowNull && !colDef.primaryKey) parts.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null && typeof colDef.defaultValue !== 'function') {
        parts.push(`DEFAULT ${this._literal(colDef.defaultValue)}`);
      }
      colDefs.push(parts.join(' '));
    }

    for (const fk of (def.foreignKeys || [])) {
      if (this._adapter.fkStrategy !== 'inline') continue;
      const refTable = fk.references.table;
      const refCol = fk.references.column;
      const colName = fk.columnName;
      const fkName = fk.constraintName;
      const onDelete = fk.onDelete || 'RESTRICT';
      const onUpdate = fk.onUpdate || 'RESTRICT';
      colDefs.push(`CONSTRAINT ${this._q(fkName)} FOREIGN KEY (${this._q(colName)}) REFERENCES ${this._q(refTable)} (${this._q(refCol)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
      const schema = this._adapter.schemas.get(def.tableName);
      schema.foreignKeys.push({ ...fk });
    }

    const sql = `CREATE TABLE ${this._q(def.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
    await this._execute(sql);
  }

  async dropTable(tableName, options = {}) {
    await this.truncateTable(tableName, { ...options, ifExists: true, ignoreForeignKeys: true });
    await this._execute(`DROP TABLE IF EXISTS ${this._q(tableName)}`);
    await super.dropTable(tableName, options);
  }

  async truncateTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;

    const ignoreForeignKeys = options.ignoreForeignKeys !== false;
    const foreignKeysBefore = this._db().pragma('foreign_keys', { simple: true });

    try {
      if (ignoreForeignKeys && foreignKeysBefore) this._db().pragma('foreign_keys = OFF');
      await this._execute(`DELETE FROM ${this._q(tableName)}`);
      await this._execute('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
    } finally {
      if (ignoreForeignKeys && foreignKeysBefore) this._db().pragma('foreign_keys = ON');
    }
  }

  async hasTable(tableName) {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name=?";
    const row = this._measureSql(sql, [tableName], () => this._db().prepare(sql).get(tableName));
    return !!row;
  }

  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    const sql = `PRAGMA table_info(${this._q(tableName)})`;
    const rows = this._measureSql(sql, [], () => this._db().prepare(sql).all());
    return { tableName, columns: rows.map(row => ({ name: row.name, type: row.type, allowNull: !row.notnull, primaryKey: !!row.pk, defaultValue: row.dflt_value })) };
  }

  introspectDefinition(definition) {
    const def = this.normalizeDefinition(definition);
    const tableInfoSql = `PRAGMA table_info(${this._q(def.tableName)})`;
    const tableInfo = this._measureSql(tableInfoSql, [], () => this._db().prepare(tableInfoSql).all());
    const physicalColumnNames = tableInfo.map(row => row.name);
    const physicalColumns = new Map(physicalColumnNames.map(name => [name.toLowerCase(), name]));
    const columns = {};
    const attrToColumn = {};
    const columnToAttr = {};
    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const columnName = colDef.field || def.attrToColumn[attrName] || attrName;
      let physicalColumnName = physicalColumns.get(columnName.toLowerCase());
      if (!physicalColumnName && def.timestamps && (attrName === def.createdAt || attrName === def.updatedAt)) {
        const normalizedTimestampName = columnName.replaceAll('_', '').toLowerCase();
        physicalColumnName = physicalColumnNames.find(name => name.replaceAll('_', '').toLowerCase() === normalizedTimestampName);
      }
      if (!physicalColumnName) continue;
      columns[attrName] = { ...colDef, field: physicalColumnName };
      attrToColumn[attrName] = physicalColumnName;
      columnToAttr[physicalColumnName] = attrName;
    }

    const indexSql = `PRAGMA index_list(${this._q(def.tableName)})`;
    const indexRows = this._measureSql(indexSql, [], () => this._db().prepare(indexSql).all());
    const existingIndexNames = new Set(indexRows.map(row => row.name));
    const uniqueConstraints = def.uniqueConstraints.filter(item => existingIndexNames.has(item.constraintName));
    const indexes = def.indexes.filter(item => existingIndexNames.has(item.name));

    const foreignKeySql = `PRAGMA foreign_key_list(${this._q(def.tableName)})`;
    const physicalFKs = this._measureSql(foreignKeySql, [], () => this._db().prepare(foreignKeySql).all());
    const foreignKeys = def.foreignKeys.filter(fk => physicalFKs.some(row =>
      row.from === fk.columnName && row.table === fk.references.table && row.to === fk.references.column
    ));

    return { ...def, columns, attrToColumn, columnToAttr, uniqueConstraints, indexes, foreignKeys };
  }

  async listTables() {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    const rows = this._measureSql(sql, [], () => this._db().prepare(sql).all());
    return rows.map(r => r.name);
  }

  async addForeignKey(tableName, fk) {
    if (this._adapter.fkStrategy === 'alter') return super.addForeignKey(tableName, fk);
    const schema = this._adapter.schemas.get(tableName);
    if (schema?.foreignKeys.some(existing => existing.constraintName === fk.constraintName)) return;
    throw new AdapterError('SQLite cannot add a foreign key to an existing table without rebuilding it', {
      code: 'SEQ_DDL_FOREIGN_KEY_ALTER_NOT_SUPPORTED',
      details: { tableName, constraintName: fk.constraintName }
    });
  }

  _literal(value) {
    if (value === null) return 'NULL';
    if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    }
    throw new AdapterError('Unsupported SQLite default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }

  _formatDefaultValue(value) {
    return this._literal(value);
  }
}

class SQLiteError extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'SQLiteError';
    this.code = options.code || 'SEQ_SQLITE_ERROR';
  }

  static missingDependency(dependency, cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

SQLiteAdapter requiere la dependencia "${dependency}". Instalala con: npm install ${dependency}

-------------------------------------------------------------------------------------------------------------

`;
    return new SQLiteError(message, {
      code: 'SEQ_SQLITE_MISSING_DEPENDENCY',
      details: { dependency },
      cause
    });
  }

  static from(error) {
    if (!String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return error;

    const name = /^(.*? constraint failed)(?::|$)/i.exec(error.message || '')?.[1] || 'SQLITE_CONSTRAINT';
    const fields = constraintFields$1(error.message);
    const type = constraintType$1(error.code);
    return new SQLiteError(error.message, {
      status: 409,
      code: 'CONFLICT',
      errors: constraintErrors$1(fields, type),
      details: {
        name,
        sqliteCode: error.code,
        constraint: { adapter: 'sqlite', type, fields, name },
      },
      cause: error
    });
  }
}

function constraintFields$1(message = '') {
  return message.match(/(?:UNIQUE|NOT NULL) constraint failed: (.+)$/)?.[1]
    ?.split(',')
    .map(field => field.trim().split('.').pop())
    .filter(Boolean) || [];
}

function constraintType$1(code) {
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return 'unique';
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'notNull';
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'foreignKey';
  if (code === 'SQLITE_CONSTRAINT_CHECK') return 'check';
  return 'constraint';
}

function constraintErrors$1(fields, type) {
  if (!fields.length) return null;
  const message = type === 'notNull' ? 'Requerido' : 'Ya existe un registro con este valor';
  return Object.fromEntries(fields.map(field => [field, message]));
}

class SQLiteDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  _toError(error) {
    return SQLiteError.from(error);
  }

  // ---------------------------------------------------------------------------
  // Execution hooks — SQLite-specific
  // ---------------------------------------------------------------------------

  async _executeQueryAll(sql, params) {
    return this._measureSql(sql, params, () => {
      try {
        return this._db().prepare(sql).all(...params);
      } catch (error) {
        throw this._toError(error);
      }
    });
  }

  async _executeGet(sql, params) {
    return this._measureSql(sql, params, () => {
      try {
        return this._db().prepare(sql).get(...params);
      } catch (error) {
        throw this._toError(error);
      }
    });
  }

  _execute(sql, params = []) {
    return this._measureSql(sql, params, () => {
      try {
        return this._db().prepare(sql).run(...params);
      } catch (error) {
        throw this._toError(error);
      }
    });
  }

  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }

  // ---------------------------------------------------------------------------
  // Serialization — SQLite-specific type handling
  // ---------------------------------------------------------------------------

  _serializeValue(v) {
    if (v instanceof Date) return v.toISOString();
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return JSON.stringify(v);
    return v;
  }

  _toAttrNames(record, schema) {
    const result = {};
    const map = schema.columnToAttr;
    const columns = schema.columns || {};
    for (const [key, value] of Object.entries(record)) {
      const attrName = map[key] || key;
      const colDef = columns[attrName];
      const typeName = colDef?.type?.constructor?.name;
      if (typeName === 'ArrayType' || typeName === 'ObjectType' || typeName === 'JSONType') {
        if (typeof value === 'string') {
          try { result[attrName] = JSON.parse(value); } catch { result[attrName] = value; }
        } else {
          result[attrName] = value;
        }
      } else if (typeName === 'BooleanType') {
        if (typeof value === 'boolean') result[attrName] = value;
        else result[attrName] = value === 1 || value === '1';
      } else if (typeName === 'DateType') {
        if (value instanceof Date) result[attrName] = value;
        else if (typeof value === 'string') {
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) throw new AdapterError(`Invalid date stored in column "${key}"`, {
            code: 'SEQ_ADAPTER_INVALID_STORED_VALUE', details: { column: key, value }
          });
          result[attrName] = date;
        }
        else result[attrName] = value;
      } else {
        result[attrName] = value;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Adapter-specific methods — truncate
  // ---------------------------------------------------------------------------

  async bulkInsert(model, records, options = {}) {
    this._assertTransaction(options);
    if (records.length === 0) return [];

    const { tableName, schema } = this._schema(model);
    const insertOne = (values) => {
      const colRecord = this._toColumnNames(values, schema);
      this._applyDefaults(colRecord, schema);
      this._applyTimestamps(colRecord, schema);
      if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];
      this._validateRecord(colRecord, schema, model.modelName);

      const cols = Object.keys(colRecord);
      const colNames = cols.map(c => this._q(c)).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
      const params = cols.map(c => this._serializeValue(colRecord[c]));
      const info = this._execute(sql, params);

      if (schema.primaryKey && !colRecord[schema.primaryKey]) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      const attrRecord = this._toAttrNames(colRecord, schema);
      return new model(attrRecord, { _isNew: false });
    };

    const insertMany = this._db().transaction(items => items.map(insertOne));
    return insertMany(records);
  }
/* ver para refactorizar y usar
  async upsert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const conflictFields = this._resolveUpsertConflictFields(model, values, options, schema);

    // SQLite only accepts ON CONFLICT targets backed by a real PRIMARY KEY or UNIQUE constraint.
    // Arbitrary where clauses still use the adapter-agnostic select/update/insert fallback.
    if (conflictFields.length === 0 || !this._isNativeConflictTarget(conflictFields, schema)) {
      return super.upsert(model, values, options);
    }

    // Read first so the public return value can include the "created" flag.
    const where = this._resolveUpsertWhere(model, values, options, schema);
    const existing = await this.selectOne(model, { where, transaction: options.transaction });
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];

    try {
      this._validateRecord(colRecord, schema, model.modelName);
    } catch (error) {
      if (existing) return super.upsert(model, values, options);
      throw error;
    }

    const cols = Object.keys(colRecord);
    if (cols.length === 0) return super.upsert(model, values, options);

    const conflictCols = conflictFields.map(field => schema.attrToColumn[field] || field);
    const createdCol = schema.timestamps ? (schema.attrToColumn[schema.createdAt] || schema.createdAt) : null;
    const updateCols = cols.filter(col => !conflictCols.includes(col) && col !== schema.autoIncrement && col !== createdCol);

    // Builds:
    // INSERT INTO table (...) VALUES (...)
    // ON CONFLICT (...) DO UPDATE SET col = excluded.col
    const assignments = updateCols.length > 0
      ? updateCols.map(col => `${this._q(col)} = excluded.${this._q(col)}`)
      : [`${this._q(conflictCols[0])} = excluded.${this._q(conflictCols[0])}`];

    const sql = `INSERT INTO ${this._q(tableName)} (${cols.map(col => this._q(col)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (${conflictCols.map(col => this._q(col)).join(', ')}) DO UPDATE SET ${assignments.join(', ')}`;
    const params = cols.map(col => this._serializeValue(colRecord[col]));
    const info = await this._execute(sql, params);

    let resultWhere = where;
    if (!existing && schema.primaryKeyAttribute && !Object.prototype.hasOwnProperty.call(resultWhere, schema.primaryKeyAttribute) && info.lastInsertRowid) {
      resultWhere = { [schema.primaryKeyAttribute]: Number(info.lastInsertRowid) };
    }
    const instance = await this.selectOne(model, { where: resultWhere, transaction: options.transaction });
    return [instance || new model(this._toAttrNames(colRecord, schema), { _isNew: false }), !existing];
  }

  _isNativeConflictTarget(conflictFields, schema) {
    const conflictCols = conflictFields.map(field => schema.attrToColumn[field] || field);
    if (schema.primaryKey && conflictCols.length === 1 && conflictCols[0] === schema.primaryKey) return true;
    return (schema.uniqueConstraints || []).some(unique =>
      unique.columns.length === conflictCols.length
      && unique.columns.every((col, index) => col === conflictCols[index])
    );
  }
  */

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._execute(`DELETE FROM ${this._q(tableName)}`, []);
    await this._execute('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
  }
}

let transactionIdCounter$1 = 0;

class SQLiteTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async _execute(sql, params = []) {
    return this._measureSql(sql, params, () => this._db().prepare(sql).run(...params));
  }

  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent SQLite transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    }
    this._execute('BEGIN IMMEDIATE');
    const transaction = {
      id: ++transactionIdCounter$1,
      active: true,
      adapter: this._adapter
    };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    this._execute('COMMIT');
    transaction.active = false;
    this._adapter._activeTransaction = null;
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    this._execute('ROLLBACK');
    transaction.active = false;
    this._adapter._activeTransaction = null;
  }
}

let Database = null;

class SQLiteAdapter extends BaseAdapter {
  static defaultNaming = {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: undefined,
    caseStyle: 'lower'
  };

  constructor(options = {}) {
    super({ fkStrategy: 'inline', ...options });
    this._db = null;
    this._dbPath = options.database || ':memory:';
    this.ddl = new SQLiteDDL(this);
    this.dml = new SQLiteDML(this);
    this.dcl = null;
    this.tcl = new SQLiteTCL(this);
  }

  static async _loadDatabase() {
    if (!Database) {
      const module = await import('better-sqlite3');
      Database = module.default;
    }
    return Database;
  }

  async connect() {
    if (this._db) return;
    const DatabaseConstructor = await this._getDatabaseConstructor();
    this._db = new DatabaseConstructor(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._log('info', 'conectado');
  }

  async authenticate() {
    await this.connect();
    await this.dml._executeGet('SELECT 1 AS ok', []);
    return true;
  }

  async validateDependencies() {
    await this._getDatabaseConstructor();
    return true;
  }

  async _getDatabaseConstructor() {
    try {
      return await this.constructor._loadDatabase();
    } catch (error) {
      const sqliteError = SQLiteError.missingDependency('better-sqlite3', error);
      this._dependencyWarning(sqliteError.message);
      throw sqliteError;
    }
  }

  _dependencyWarning(message) {
    if (this._seq) {
      this._log('error', message);
      return;
    }
    console.error(`[Seq] ${message}`);
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._log('info', 'desconectado');
    }
  }

  async initialize() {
    if (!this._db) await this.connect();
  }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'INTEGER';
      case 'DecimalType':
      case 'NumberType': return 'REAL';
      case 'StringType': return 'TEXT';
      case 'BooleanType': return 'INTEGER';
      case 'DateType': return 'TEXT';
      case 'ArrayType':
      case 'ObjectType':
      case 'JSONType': return 'TEXT';
      default: return 'TEXT';
    }
  }

  cloneRecord(record) {
    return { ...record };
  }
}

class MySQLError extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'MySQLError';
    this.code = options.code || 'SEQ_MYSQL_ERROR';
  }

  static missingDependency(dependency, cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

MySQLAdapter requiere la dependencia "${dependency}". Instalala con: npm install ${dependency}

-------------------------------------------------------------------------------------------------------------

`;
    return new MySQLError(message, {
      code: 'SEQ_MYSQL_MISSING_DEPENDENCY',
      details: { dependency },
      cause
    });
  }

  static from(error) {
    const constraintCodes = new Set([
      'ER_DUP_ENTRY',
      'ER_NO_REFERENCED_ROW',
      'ER_NO_REFERENCED_ROW_2',
      'ER_ROW_IS_REFERENCED',
      'ER_ROW_IS_REFERENCED_2',
      'ER_BAD_NULL_ERROR',
      'ER_CHECK_CONSTRAINT_VIOLATED'
    ]);
    if (!constraintCodes.has(error?.code)) return error;

    const fields = constraintFields(error);
    const type = constraintType(error.code);
    return new MySQLError(error.message, {
      status: 409,
      code: 'CONFLICT',
      errors: constraintErrors(fields, type),
      details: {
        constraint: { adapter: 'mysql', type, fields, name: constraintName(error) },
        mysqlCode: error.code,
        errno: error.errno,
        sqlState: error.sqlState
      },
      cause: error
    });
  }
}

function constraintFields(error) {
  if (error?.code === 'ER_BAD_NULL_ERROR') return [error.message?.match(/Column '([^']+)' cannot be null/i)?.[1]].filter(Boolean);

  const keyName = constraintName(error);
  if (!keyName) return [];

  const field = keyName.startsWith('uk_') ? keyName.split('_').pop() : keyName;
  return [field].filter(Boolean);
}

function constraintName(error) {
  return error?.message?.match(/for key ['"`](?:.+\.)?([^'"`]+)['"`]/i)?.[1] || null;
}

function constraintType(code) {
  if (code === 'ER_DUP_ENTRY') return 'unique';
  if (code === 'ER_BAD_NULL_ERROR') return 'notNull';
  if (code === 'ER_NO_REFERENCED_ROW' || code === 'ER_NO_REFERENCED_ROW_2') return 'foreignKey';
  if (code === 'ER_ROW_IS_REFERENCED' || code === 'ER_ROW_IS_REFERENCED_2') return 'referenced';
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') return 'check';
  return 'constraint';
}

function constraintErrors(fields, type) {
  if (!fields.length) return null;
  const message = type === 'notNull' ? 'Requerido' : 'Ya existe un registro con este valor';
  return Object.fromEntries(fields.map(field => [field, message]));
}

class MySQLDDL extends DDLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _connection() {
    return this._adapter._connection();
  }

  async _execute(sql, params = []) {
    return this._measureSql(sql.replaceAll('\n  ', ' '), params, async () => {
      try {
        const [result] = await this._adapter._withConnection(connection => connection.execute(sql, params));
        return result;
      } catch (error) {
        throw MySQLError.from(error);
      }
    });
  }

  async createTableStructure(def) {
    const colDefs = [];
    const primaryKeys = [];

    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const colName = colDef.field || attrName;
      const parts = [this._q(colName), this._adapter.mapDataType(colDef.type)];
      if (!colDef.allowNull && !colDef.primaryKey) parts.push('NOT NULL');
      if (colDef.autoIncrement) parts.push('AUTO_INCREMENT');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null && typeof colDef.defaultValue !== 'function') {
        parts.push(`DEFAULT ${this._formatDefaultValue(colDef.defaultValue)}`);
      }
      colDefs.push(parts.join(' '));
      if (colDef.primaryKey) primaryKeys.push(colName);
    }

    if (primaryKeys.length > 0) {
      colDefs.push(`PRIMARY KEY (${primaryKeys.map(col => this._q(col)).join(', ')})`);
    }

    const sql = `CREATE TABLE ${this._q(def.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
    await this._execute(sql);
  }

  async dropTable(tableName, options = {}) {
    if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await this._execute(`DROP TABLE IF EXISTS ${this._q(tableName)}`);
    } finally {
      if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 1');
    }
    await super.dropTable(tableName, options);
  }

  async truncateTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;
    if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`);
    } finally {
      if (options.ignoreForeignKeys !== false) await this._execute('SET FOREIGN_KEY_CHECKS = 1');
    }
  }

  async hasTable(tableName) {
    const row = await this._executeGet(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
      [tableName]
    );
    return !!row;
  }

  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) {
      throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    }
    const rows = await this._executeQueryAll(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    return {
      tableName,
      columns: rows.map(row => ({
        name: row.COLUMN_NAME,
        type: row.COLUMN_TYPE,
        allowNull: row.IS_NULLABLE === 'YES',
        primaryKey: row.COLUMN_KEY === 'PRI',
        autoIncrement: String(row.EXTRA || '').includes('auto_increment'),
        defaultValue: row.COLUMN_DEFAULT
      }))
    };
  }

  async introspectDefinition(definition) {
    const def = this.normalizeDefinition(definition);
    const columnsInfo = await this._executeQueryAll(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [def.tableName]
    );
    const physicalColumnNames = columnsInfo.map(row => row.COLUMN_NAME);
    const physicalColumns = new Map(physicalColumnNames.map(name => [name.toLowerCase(), name]));
    const columns = {};
    const attrToColumn = {};
    const columnToAttr = {};

    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const columnName = colDef.field || def.attrToColumn[attrName] || attrName;
      let physicalColumnName = physicalColumns.get(columnName.toLowerCase());
      if (!physicalColumnName && def.timestamps && (attrName === def.createdAt || attrName === def.updatedAt)) {
        const normalizedTimestampName = columnName.replaceAll('_', '').toLowerCase();
        physicalColumnName = physicalColumnNames.find(name => name.replaceAll('_', '').toLowerCase() === normalizedTimestampName);
      }
      if (!physicalColumnName) continue;
      columns[attrName] = { ...colDef, field: physicalColumnName };
      attrToColumn[attrName] = physicalColumnName;
      columnToAttr[physicalColumnName] = attrName;
    }

    const indexRows = await this._executeQueryAll(
      `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [def.tableName]
    );
    const existingIndexNames = new Set(indexRows.map(row => row.INDEX_NAME));
    const uniqueConstraints = def.uniqueConstraints.filter(item => existingIndexNames.has(item.constraintName));
    const indexes = def.indexes.filter(item => existingIndexNames.has(item.name));

    const fkRows = await this._executeQueryAll(
      `SELECT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [def.tableName]
    );
    const existingFKNames = new Set(fkRows.map(row => row.CONSTRAINT_NAME));
    const foreignKeys = def.foreignKeys.filter(fk => existingFKNames.has(fk.constraintName));

    return { ...def, columns, attrToColumn, columnToAttr, uniqueConstraints, indexes, foreignKeys };
  }

  async listTables() {
    const rows = await this._executeQueryAll(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?',
      ['BASE TABLE']
    );
    return rows.map(row => row.TABLE_NAME);
  }

  async addColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [name, colDef] of Object.entries(missingColumns)) {
      const colType = this._adapter.mapDataType(colDef.type);
      const columnName = colDef.field || name;
      const constraints = [];
      if (!colDef.allowNull && colDef.defaultValue === undefined) {
        throw new AdapterError(`Cannot add required column "${name}" without a default value`, {
          code: 'SEQ_DDL_REQUIRED_COLUMN_NEEDS_DEFAULT',
          details: { tableName, field: name }
        });
      }
      if (!colDef.allowNull) constraints.push('NOT NULL');
      if (colDef.defaultValue !== undefined && colDef.defaultValue !== null) {
        const value = typeof colDef.defaultValue === 'function' ? colDef.defaultValue() : colDef.defaultValue;
        constraints.push(`DEFAULT ${this._formatDefaultValue(value)}`);
      }
      await this._execute(`ALTER TABLE ${this._q(tableName)} ADD COLUMN ${this._q(columnName)} ${colType}${constraints.length ? ` ${constraints.join(' ')}` : ''}`);
      schema.columns[name] = colDef;
      schema.attrToColumn[name] = columnName;
      schema.columnToAttr[columnName] = name;
    }
  }

  async addUniqueConstraint(tableName, constraint) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = constraint.columns.map(c => this._q(c)).join(', ');
    await this._execute(`CREATE UNIQUE INDEX ${this._q(constraint.constraintName)} ON ${this._q(tableName)} (${cols})`);
    schema.uniqueConstraints.push({ ...constraint });
  }

  async addIndex(tableName, index) {
    const schema = this._adapter.schemas.get(tableName);
    const cols = index.columns.map(c => this._q(c)).join(', ');
    const unique = index.unique ? 'UNIQUE ' : '';
    await this._execute(`CREATE ${unique}INDEX ${this._q(index.name)} ON ${this._q(tableName)} (${cols})`);
    schema.indexes.push({ ...index });
  }

  async addForeignKey(tableName, fk) {
    const sql = `ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(fk.constraintName)} FOREIGN KEY (${this._q(fk.columnName)}) REFERENCES ${this._q(fk.references.table)} (${this._q(fk.references.column)}) ON DELETE ${fk.onDelete || 'RESTRICT'} ON UPDATE ${fk.onUpdate || 'RESTRICT'}`;
    await this._execute(sql);
    const schema = this._adapter.schemas.get(tableName);
    schema.foreignKeys.push({ ...fk });
  }

  async _executeQueryAll(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        const [rows] = await this._adapter._withConnection(connection => connection.execute(sql, params));
        return rows;
      } catch (error) {
        throw MySQLError.from(error);
      }
    });
  }

  async _executeGet(sql, params = []) {
    const rows = await this._executeQueryAll(sql, params);
    return rows[0] || null;
  }

  _formatDefaultValue(value) {
    if (value === null) return 'NULL';
    if (value instanceof Date) return `'${this._formatDate(value)}'`;
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
    }
    throw new AdapterError('Unsupported MySQL default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }

  _formatDate(date) {
    return date.toISOString().slice(0, 23).replace('T', ' ');
  }
}

class MySQLDML extends DMLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _connection() {
    return this._adapter._connection();
  }

  async _executeQueryAll(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        const [rows] = await this._adapter._withConnection(connection => connection.execute(sql, params));
        return rows;
      } catch (error) {
        throw MySQLError.from(error);
      }
    });
  }

  async _executeGet(sql, params = []) {
    const rows = await this._executeQueryAll(sql, params);
    return rows[0] || null;
  }

  async _execute(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        const [result] = await this._adapter._withConnection(connection => connection.execute(sql, params));
        return {
          changes: result.affectedRows || 0,
          lastInsertRowid: result.insertId || 0
        };
      } catch (error) {
        throw MySQLError.from(error);
      }
    });
  }

  _buildLimitOffset(options) {
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    }
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
      throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    }
    if (options.limit && options.offset) return ` LIMIT ${options.limit} OFFSET ${options.offset}`;
    if (options.limit) return ` LIMIT ${options.limit}`;
    if (options.offset) return ` LIMIT 18446744073709551615 OFFSET ${options.offset}`;
    return '';
  }

  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const colRecord = this._toColumnNames(values, schema);
    this._applyDefaults(colRecord, schema);
    this._applyTimestamps(colRecord, schema);
    if (schema.autoIncrement && colRecord[schema.autoIncrement] === undefined) delete colRecord[schema.autoIncrement];
    this._validateRecord(colRecord, schema, model.modelName);

    const cols = Object.keys(colRecord);
    if (cols.length === 0) {
      const info = await this._execute(`INSERT INTO ${this._q(tableName)} () VALUES ()`, []);
      if (schema.primaryKey) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
      return new model(this._toAttrNames(colRecord, schema), { _isNew: false });
    }

    const colNames = cols.map(c => this._q(c)).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${this._q(tableName)} (${colNames}) VALUES (${placeholders})`;
    const params = cols.map(c => this._serializeValue(colRecord[c]));
    const info = await this._execute(sql, params);
    if (schema.primaryKey && !colRecord[schema.primaryKey]) colRecord[schema.primaryKey] = Number(info.lastInsertRowid);
    return new model(this._toAttrNames(colRecord, schema), { _isNew: false });
  }

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._execute('SET FOREIGN_KEY_CHECKS = 0', []);
    try {
      await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`, []);
    } finally {
      await this._execute('SET FOREIGN_KEY_CHECKS = 1', []);
    }
  }

  _serializeValue(value) {
    if (value instanceof Date) return this._formatDate(value);
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value);
    return value;
  }

  _toAttrNames(record, schema) {
    const result = {};
    const map = schema.columnToAttr;
    const columns = schema.columns || {};
    for (const [key, value] of Object.entries(record)) {
      const attrName = map[key] || key;
      const colDef = columns[attrName];
      const typeName = colDef?.type?.constructor?.name;
      if (typeName === 'ArrayType' || typeName === 'ObjectType' || typeName === 'JSONType') {
        if (typeof value === 'string') {
          try { result[attrName] = JSON.parse(value); } catch { result[attrName] = value; }
        } else {
          result[attrName] = value;
        }
      } else if (typeName === 'BooleanType') {
        if (typeof value === 'boolean') result[attrName] = value;
        else result[attrName] = value === 1 || value === '1';
      } else if (typeName === 'DateType') {
        if (value instanceof Date) result[attrName] = value;
        else if (typeof value === 'string') result[attrName] = new Date(value);
        else result[attrName] = value;
      } else if (typeName === 'DecimalType' || typeName === 'NumberType') {
        result[attrName] = value === null || value === undefined ? value : Number(value);
      } else {
        result[attrName] = value;
      }
    }
    return result;
  }

  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }

  _formatDate(date) {
    return date.toISOString().slice(0, 23).replace('T', ' ');
  }
}

let transactionIdCounter = 0;

class MySQLTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent MySQL transactions are not supported', {
        code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT'
      });
    }

    const connection = await this._adapter._acquireConnection();
    try {
      await connection.beginTransaction();
    } catch (error) {
      connection.release();
      throw error;
    }
    const transaction = {
      id: ++transactionIdCounter,
      active: true,
      adapter: this._adapter,
      connection
    };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    try {
      await transaction.connection.commit();
    } finally {
      this._release(transaction);
    }
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    try {
      await transaction.connection.rollback();
    } finally {
      this._release(transaction);
    }
  }

  _release(transaction) {
    transaction.active = false;
    transaction.connection.release();
    transaction.connection = null;
    this._adapter._activeTransaction = null;
  }
}

let mysqlClient = null;

class MySQLAdapter extends BaseAdapter {
  static defaultNaming = {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: undefined,
    caseStyle: 'lower',
    maxLength: 64
  };

  constructor(options = {}) {
    super({ fkStrategy: 'alter', ...options });
    this._pool = null;
    this._configuredConnections = new WeakSet();
    this._lastConnectionUse = new WeakMap();
    this._validationIdleTimeout = this._normalizeValidationIdleTimeout(options.validationIdleTimeout ?? 15000);
    this._sessionTimeouts = this._normalizeSessionTimeouts(options);
    this._connectionOptions = this._normalizeConnectionOptions(options);
    this.ddl = new MySQLDDL(this);
    this.dml = new MySQLDML(this);
    this.dcl = null;
    this.tcl = new MySQLTCL(this);
  }

  static async _loadClient() {
    if (!mysqlClient) mysqlClient = await import('mysql2/promise');
    return mysqlClient;
  }

  async validateDependencies() {
    await this._getClient();
    return true;
  }

  async connect() {
    if (this._pool) return;
    const mysql = await this._getClient();
    this._pool = mysql.createPool(this._connectionOptions);
    this._log('info', 'conectado');
  }

  async authenticate() {
    await this.connect();
    await this.dml._executeGet('SELECT 1 AS ok', []);
    return true;
  }

  async close() {
    if (this._activeTransaction) await this.tcl.rollback(this._activeTransaction);
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
      this._log('info', 'desconectado');
    }
  }

  async initialize() {
    if (!this._pool) await this.connect();
  }

  _connection() {
    return this._activeTransaction?.connection || this._pool;
  }

  async _acquireConnection() {
    await this.connect();
    let lastError;

    for (let attempt = 0; attempt < 2; attempt++) {
      const connection = await this._pool.getConnection();
      try {
        await this._configureConnection(connection);
        if (this._requiresValidation(connection)) {
          await this._measureSql('SELECT 1', [], () => connection.execute('SELECT 1'));
          this._markConnectionUsed(connection);
        }
        return connection;
      } catch (error) {
        lastError = error;
        connection.destroy();
      }
    }

    throw lastError;
  }

  async _withConnection(run) {
    if (this._activeTransaction) return run(this._activeTransaction.connection);

    const connection = await this._acquireConnection();
    try {
      const result = await run(connection);
      this._markConnectionUsed(connection);
      return result;
    } finally {
      connection.release();
    }
  }

  async _configureConnection(connection) {
    // mysql2/promise creates a lightweight PromisePoolConnection wrapper on
    // every checkout. The underlying PoolConnection is the physical session
    // whose server-side settings persist while it remains in the pool.
    const physicalConnection = connection.connection ?? connection;
    if (this._configuredConnections.has(physicalConnection)) return;
    const { waitTimeout, interactiveTimeout } = this._sessionTimeouts;
    await this._measureSql(`SET SESSION wait_timeout = ${waitTimeout}`, [], () => connection.execute(`SET SESSION wait_timeout = ${waitTimeout}`));
    await this._measureSql(`SET SESSION interactive_timeout = ${interactiveTimeout}`, [], () => connection.execute(`SET SESSION interactive_timeout = ${interactiveTimeout}`));
    this._configuredConnections.add(physicalConnection);
  }

  _physicalConnection(connection) {
    return connection.connection ?? connection;
  }

  _requiresValidation(connection) {
    const lastUse = this._lastConnectionUse.get(this._physicalConnection(connection));
    return lastUse === undefined || Date.now() - lastUse >= this._validationIdleTimeout;
  }

  _markConnectionUsed(connection) {
    this._lastConnectionUse.set(this._physicalConnection(connection), Date.now());
  }

  _quoteIdentifier(name) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) {
      throw new TypeError('SQL identifiers must be non-empty strings without null bytes');
    }
    return `\`${name.replaceAll('`', '``')}\``;
  }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'INTEGER';
      case 'DecimalType': {
        const precision = dataType.options?.precision ?? 10;
        const scale = dataType.options?.scale ?? 2;
        return `DECIMAL(${precision}, ${scale})`;
      }
      case 'NumberType': return 'DOUBLE';
      case 'StringType': return `VARCHAR(${dataType.options?.length ?? 255})`;
      case 'BooleanType': return 'TINYINT(1)';
      case 'DateType': return 'DATETIME(3)';
      case 'ArrayType':
      case 'ObjectType':
      case 'JSONType': return 'JSON';
      default: return 'TEXT';
    }
  }

  cloneRecord(record) {
    return { ...record };
  }

  async _getClient() {
    try {
      return await this.constructor._loadClient();
    } catch (error) {
      const mysqlError = MySQLError.missingDependency('mysql2', error);
      this._dependencyWarning(mysqlError.message);
      throw mysqlError;
    }
  }

  _dependencyWarning(message) {
    if (this._seq) {
      this._log('error', message);
      return;
    }
    console.error(`[Seq] ${message}`);
  }

  _normalizeConnectionOptions(options) {
    const {naming, fkStrategy, eager, waitTimeout, interactiveTimeout, validationIdleTimeout, ...connectionOptions} = options;
    return {
      host: 'localhost', port: 3306, user: 'root', database: 'seq',
      waitForConnections: true, connectionLimit: 10, maxIdle: 10, idleTimeout: 60000,
      timezone: 'Z', supportBigNumbers: true, ...connectionOptions
    };
  }

  _normalizeSessionTimeouts(options) {
    return {
      waitTimeout: this._normalizeTimeout(options.waitTimeout ?? 300, 'waitTimeout'),
      interactiveTimeout: this._normalizeTimeout(options.interactiveTimeout ?? 300, 'interactiveTimeout')
    };
  }

  _normalizeTimeout(value, name) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer in seconds`);
    return value;
  }

  _normalizeValidationIdleTimeout(value) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError('validationIdleTimeout must be a non-negative integer in milliseconds');
    return value;
  }
}

class Oracle11Error extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'Oracle11Error';
    this.code = options.code || 'SEQ_ORACLE_ERROR';
  }

  static missingDependency(cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

Oracle11Adapter requiere la dependencia "oracledb". Instalala con: npm install oracledb

-------------------------------------------------------------------------------------------------------------

`;
    return new Oracle11Error(message, {
      code: 'SEQ_ORACLE_MISSING_DEPENDENCY', details: { dependency: 'oracledb' }, cause
    });
  }

  static unsupportedDependencyVersion(version) {
    const message = `
-------------------------------------------------------------------------------------------------------------

Oracle11Adapter requiere la dependencia "oracledb" en version menor o igual a 5.5.0. Version instalada: ${version}.

-------------------------------------------------------------------------------------------------------------

`;
    return new Oracle11Error(message, {
      code: 'SEQ_ORACLE_UNSUPPORTED_DEPENDENCY_VERSION',
      details: { dependency: 'oracledb', version, maxVersion: '5.5.0' }
    });
  }

  static from(error) {
    const oracleCode = error?.code || (error?.errorNum ? `ORA-${String(error.errorNum).padStart(5, '0')}` : undefined);
    if (!['ORA-00001', 'ORA-02291', 'ORA-02292', 'ORA-01400'].includes(oracleCode)) return error;
    const type = oracleCode === 'ORA-00001' ? 'unique' : oracleCode === 'ORA-01400' ? 'notNull' : oracleCode === 'ORA-02291' ? 'foreignKey' : 'referenced';
    return new Oracle11Error(error.message, {
      status: 409, code: 'CONFLICT',
      details: { constraint: { adapter: 'oracle', type }, oracleCode }, cause: error
    });
  }
}

class Oracle11DDL extends DDLAbstract {
  _connection() {
    return this._adapter._connection();
  }

  _oracleSql(sql) {
    let index = 0; return sql.replaceAll('?', () => `:${++index}`);
  }

  async _execute(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(connection => connection.execute(this._oracleSql(sql), params, { autoCommit: !this._adapter._activeTransaction }));
      } catch (error) {
        throw Oracle11Error.from(error);
      }
    });
  }
  async _executeQueryAll(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(async connection => (await connection.execute(this._oracleSql(sql), params, { outFormat: this._adapter._client.OUT_FORMAT_OBJECT })).rows || []);
      } catch (error) {
        throw Oracle11Error.from(error);
      }
    });
  }
  async _executeGet(sql, params = []) { 
    return (await this._executeQueryAll(sql, params))[0] || null;
  }
  
  _usesSequenceForAutoIncrement() { return true; }

  async createTableStructure(def) {
    const columns = []; const primaryKeys = [];
    for (const [attr, column] of Object.entries(def.columns)) {
      const name = column.field || attr;
      const parts = [this._q(name), this._adapter.mapDataType(column.type)];
      if (column.defaultValue !== undefined && column.defaultValue !== null && typeof column.defaultValue !== 'function') parts.push(`DEFAULT ${this._formatDefaultValue(column.defaultValue)}`);
      if (!column.allowNull && !column.primaryKey) parts.push('NOT NULL');
      columns.push(parts.join(' ')); if (column.primaryKey) primaryKeys.push(name);
    }
    if (primaryKeys.length) columns.push(`PRIMARY KEY (${primaryKeys.map(key => this._q(key)).join(', ')})`);
    await this._execute(`CREATE TABLE ${this._q(def.tableName)} (\n  ${columns.join(',\n  ')}\n)`);
    if (def.autoIncrement && this._usesSequenceForAutoIncrement()) await this._execute(`CREATE SEQUENCE ${this._q(this._adapter.sequenceName(def.tableName))} START WITH 1 INCREMENT BY 1`);
  }

  async dropTable(tableName, options = {}) {
    if (options.ifExists && !(await this.hasTable(tableName))) return;
    await this._execute(`DROP TABLE ${this._q(tableName)}${options.ignoreForeignKeys !== false ? ' CASCADE CONSTRAINTS' : ''}`);
    try { await this._execute(`DROP SEQUENCE ${this._q(this._adapter.sequenceName(tableName))}`); } catch (error) { if (!/ORA-02289/.test(error?.message || '')) throw error; }
    await super.dropTable(tableName, options);
  }
  async truncateTable(tableName, options = {}) { 
    if (!options.ifExists || await this.hasTable(tableName)) await this._execute(`TRUNCATE TABLE ${this._q(tableName)}`);
  }

  async hasTable(tableName) {
    return !!await this._executeGet('SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME = ?', [tableName]);
  }

  async listTables() { 
    return (await this._executeQueryAll('SELECT TABLE_NAME FROM USER_TABLES')).map(row => row.TABLE_NAME);
  }
  
  async describeTable(tableName) {
    if (!(await this.hasTable(tableName))) throw new AdapterError(`Table "${tableName}" does not exist`, { code: 'SEQ_ADAPTER_TABLE_NOT_FOUND' });
    const rows = await this._executeQueryAll('SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE, DATA_DEFAULT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = ? ORDER BY COLUMN_ID', [tableName]);
    const primaryKeys = new Set((await this._executeQueryAll('SELECT COLUMN_NAME FROM USER_CONS_COLUMNS WHERE TABLE_NAME = ? AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = \'P\')', [tableName, tableName])).map(row => row.COLUMN_NAME));
    return { tableName, columns: rows.map(row => ({ name: row.COLUMN_NAME, type: row.DATA_TYPE, allowNull: row.NULLABLE === 'Y', primaryKey: primaryKeys.has(row.COLUMN_NAME), autoIncrement: false, defaultValue: row.DATA_DEFAULT })) };
  }
  async introspectDefinition(definition) {
    const def = this.normalizeDefinition(definition);
    const columnsInfo = await this._executeQueryAll('SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = ?', [def.tableName]);
    const physicalColumnNames = columnsInfo.map(row => row.COLUMN_NAME);
    const physicalColumns = new Map(physicalColumnNames.map(name => [name.toLowerCase(), name]));
    const columns = {};
    const attrToColumn = {};
    const columnToAttr = {};

    for (const [attrName, colDef] of Object.entries(def.columns)) {
      const columnName = colDef.field || def.attrToColumn[attrName] || attrName;
      let physicalColumnName = physicalColumns.get(columnName.toLowerCase());
      if (!physicalColumnName && def.timestamps && (attrName === def.createdAt || attrName === def.updatedAt)) {
        const normalizedTimestampName = columnName.replaceAll('_', '').toLowerCase();
        physicalColumnName = physicalColumnNames.find(name => name.replaceAll('_', '').toLowerCase() === normalizedTimestampName);
      }
      if (!physicalColumnName) continue;
      columns[attrName] = { ...colDef, field: physicalColumnName };
      attrToColumn[attrName] = physicalColumnName;
      columnToAttr[physicalColumnName] = attrName;
    }

    const uniqueRows = await this._executeQueryAll("SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'U'", [def.tableName]);
    const existingUniqueNames = new Set(uniqueRows.map(row => row.CONSTRAINT_NAME));
    const uniqueConstraints = def.uniqueConstraints.filter(item => existingUniqueNames.has(item.constraintName));

    const indexRows = await this._executeQueryAll('SELECT INDEX_NAME FROM USER_INDEXES WHERE TABLE_NAME = ?',[def.tableName]);
    const existingIndexNames = new Set(indexRows.map(row => row.INDEX_NAME));
    const indexes = def.indexes.filter(item => existingIndexNames.has(item.name));

    const fkRows = await this._executeQueryAll("SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'R'", [def.tableName]);
    const existingFKNames = new Set(fkRows.map(row => row.CONSTRAINT_NAME));
    const foreignKeys = def.foreignKeys.filter(fk => existingFKNames.has(fk.constraintName));

    return { ...def, columns, attrToColumn, columnToAttr, uniqueConstraints, indexes, foreignKeys };
  }
  async addColumns(tableName, missingColumns) {
    const schema = this._adapter.schemas.get(tableName);
    for (const [attr, column] of Object.entries(missingColumns)) {
      const name = column.field || attr; const parts = [this._q(name), this._adapter.mapDataType(column.type)];
      if (column.defaultValue !== undefined && column.defaultValue !== null) {
        const value = typeof column.defaultValue === 'function' ? column.defaultValue() : column.defaultValue;
        parts.push(`DEFAULT ${this._formatDefaultValue(value)}`);
      }
      if (!column.allowNull) parts.push('NOT NULL');
      await this._execute(`ALTER TABLE ${this._q(tableName)} ADD (${parts.join(' ')})`);
      schema.columns[attr] = column; 
      schema.attrToColumn[attr] = name; 
      schema.columnToAttr[name] = attr;
    }
  }
  async addUniqueConstraint(tableName, constraint) { 
    await this._execute(`ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(constraint.constraintName)} UNIQUE (${constraint.columns.map(column => this._q(column)).join(', ')})`);
    this._adapter.schemas.get(tableName).uniqueConstraints.push({ ...constraint });
  }

  async addIndex(tableName, index) { 
    await this._execute(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${this._q(index.name)} ON ${this._q(tableName)} (${index.columns.map(column => this._q(column)).join(', ')})`); 
    this._adapter.schemas.get(tableName).indexes.push({ ...index });
  }

  async addForeignKey(tableName, fk) {
    const deleteClause = fk.onDelete === 'CASCADE' || fk.onDelete === 'SET NULL' ? ` ON DELETE ${fk.onDelete}` : '';
    await this._execute(`ALTER TABLE ${this._q(tableName)} ADD CONSTRAINT ${this._q(fk.constraintName)} FOREIGN KEY (${this._q(fk.columnName)}) REFERENCES ${this._q(fk.references.table)} (${this._q(fk.references.column)})${deleteClause}`);
    this._adapter.schemas.get(tableName).foreignKeys.push({ ...fk });
  }
  _formatDefaultValue(value) { 
    if (value === null) return 'NULL'; 
    if (value instanceof Date) return `TO_DATE('${value.toISOString().slice(0, 19).replace('T', ' ')}', 'YYYY-MM-DD HH24:MI:SS')`; 
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`; 
    if (typeof value === 'boolean') return value ? '1' : '0'; 
    if (typeof value === 'number' && Number.isFinite(value)) return String(value); 
    if (Array.isArray(value) || typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`; 
    throw new AdapterError('Unsupported Oracle default value', { code: 'SEQ_DDL_INVALID_DEFAULT' });
  }
}

class Oracle11DML extends DMLAbstract {
  _connection() { return this._adapter._connection(); }
  _tableWithAlias(tableName, alias) { return `${this._q(tableName)}${alias ? ` ${this._q(alias)}` : ''}`; }
  _toError(error) { return Oracle11Error.from(error); }

  _oracleSql(sql) { let index = 0; return sql.replaceAll('?', () => `:${++index}`); }
  async _executeQueryAll(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(async connection => (await connection.execute(this._oracleSql(sql), params, { outFormat: this._adapter._client.OUT_FORMAT_OBJECT })).rows || []);
      } catch (error) {
        throw this._toError(error);
      }
    });
  }
  async _executeGet(sql, params = []) { return (await this._executeQueryAll(sql, params))[0] || null; }
  async _execute(sql, params = []) {
    return this._measureSql(sql, params, async () => {
      try {
        return await this._adapter._withConnection(async connection => {
          const result = await connection.execute(this._oracleSql(sql), params, { autoCommit: !this._adapter._activeTransaction });
          return { changes: result.rowsAffected || 0 };
        });
      } catch (error) {
        throw this._toError(error);
      }
    });
  }

  _applyLimitOffset(sql, options) {
    const { limit, offset = 0 } = options;
    if (limit === undefined && options.offset === undefined) return sql;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    if (limit === undefined) return `SELECT * FROM (SELECT seq_page.*, ROWNUM seq_rownum FROM (${sql}) seq_page) WHERE seq_rownum > ${offset}`;
    return `SELECT * FROM (SELECT seq_page.*, ROWNUM seq_rownum FROM (${sql}) seq_page WHERE ROWNUM <= ${offset + limit}) WHERE seq_rownum > ${offset}`;
  }

  _usesSequenceForAutoIncrement() { return true; }
  _sequenceName(tableName) { return this._adapter.sequenceName(tableName); }

  async count(model, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema, alias } = this._schema(model);
    const where = this._buildWhere(options.where, schema, alias);
    const row = await this._executeGet(`SELECT COUNT(*) AS "cnt" FROM ${this._tableWithAlias(tableName, alias)}${where.sql}`, where.params);
    return row?.cnt ?? 0;
  }

  async insert(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const record = this._toColumnNames(values, schema);
    this._applyDefaults(record, schema); this._applyTimestamps(record, schema); this._validateRecord(record, schema, model.modelName);
    const pk = schema.autoIncrement;
    const generatedPk = pk && (record[pk] === undefined || record[pk] === null) && this._usesSequenceForAutoIncrement();
    if (generatedPk) record[pk] = { __oracleSequence: this._sequenceName(tableName) };
    const columns = Object.keys(record);
    if (!columns.length) throw new ValidationError('Oracle insert requires at least one column', { code: 'SEQ_ORACLE_EMPTY_INSERT' });
    let bindIndex = 0;
    const params = [];
    const valuesSql = columns.map(column => {
      if (record[column]?.__oracleSequence) return `${this._q(record[column].__oracleSequence)}.NEXTVAL`;
      params.push(this._serializeValue(record[column]));
      return `:${++bindIndex}`;
    }).join(', ');
    let sql = `INSERT INTO ${this._q(tableName)} (${columns.map(column => this._q(column)).join(', ')}) VALUES (${valuesSql})`;
    const bindParams = [...params];
    if (generatedPk) { sql += ` RETURNING ${this._q(pk)} INTO :${bindParams.length + 1}`; bindParams.push({ dir: this._adapter._client.BIND_OUT, type: this._adapter._client.NUMBER }); }
    const result = await this._measureSql(sql, bindParams, async () => {
      try {
        return await this._adapter._withConnection(connection => connection.execute(sql, bindParams, { autoCommit: !this._adapter._activeTransaction }));
      } catch (error) {
        throw this._toError(error);
      }
    });
    if (generatedPk) record[pk] = result.outBinds?.[0]?.[0] ?? result.outBinds?.[bindParams.length - 1]?.[0];
    return new model(this._toAttrNames(record, schema), { _isNew: false });
  }

  async update(model, values, options = {}) {
    this._assertTransaction(options);
    const { tableName, schema } = this._schema(model);
    const pkAttr = schema.primaryKeyAttribute;
    if (!pkAttr || !Object.prototype.hasOwnProperty.call(values, pkAttr)) return super.update(model, values, options);

    const pkCol = schema.attrToColumn[pkAttr] || pkAttr;
    const newPk = values[pkAttr];
    const matches = await this.selectAll(model, { where: options.where, attributes: [pkAttr], transaction: options.transaction });
    const oldPks = matches.map(instance => instance.getDataValue(pkAttr));
    if (oldPks.length === 0) return [];

    const cascadeFks = [];
    for (const [childTable, childSchema] of this._adapter.schemas) {
      for (const fk of childSchema.foreignKeys || []) {
        if (fk.references?.table === tableName && fk.references?.column === pkCol && fk.onUpdate === 'CASCADE') {
          cascadeFks.push({ childTable, fk });
        }
      }
    }
    if (cascadeFks.length === 0) return super.update(model, values, options);

    try {
      for (const { childTable, fk } of cascadeFks) {
        await this._execute(`ALTER TABLE ${this._q(childTable)} DISABLE CONSTRAINT ${this._q(fk.constraintName)}`, []);
      }
      const updated = await super.update(model, values, options);
      for (const oldPk of oldPks) {
        for (const { childTable, fk } of cascadeFks) {
          await this._execute(`UPDATE ${this._q(childTable)} SET ${this._q(fk.columnName)} = ? WHERE ${this._q(fk.columnName)} = ?`, [newPk, oldPk]);
        }
      }
      return updated;
    } finally {
      for (const { childTable, fk } of cascadeFks) {
        await this._execute(`ALTER TABLE ${this._q(childTable)} ENABLE CONSTRAINT ${this._q(fk.constraintName)}`, []);
      }
    }
  }

  async truncate(model, options = {}) {
    this._assertTransaction(options);
    const { tableName } = this._schema(model);
    await this._adapter.ddl.truncateTable(tableName);
  }

  _serializeValue(value) { if (value instanceof Date) return value; if (value === undefined) return null; if (typeof value === 'boolean') return value ? 1 : 0; if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value); return value; }
  _mapRows(rows, model, schema, options = {}) {
    return rows.map(row => new model(this._toAttrNames(row, schema), {
      _isNew: false,
      _partial: Array.isArray(options.attributes) && options.attributes.length > 0
    }));
  }
  _toAttrNames(record, schema) {
    const result = {}; for (const [key, value] of Object.entries(record)) { const attr = schema.columnToAttr[key] || key; if (key === 'SEQ_ROWNUM') continue; const type = schema.columns[attr]?.type?.constructor?.name; if (['ArrayType', 'ObjectType', 'JSONType'].includes(type) && typeof value === 'string') { try { result[attr] = JSON.parse(value); } catch { result[attr] = value; } } else if (type === 'BooleanType') result[attr] = value === true || value === 1 || value === '1'; else if (type === 'DateType' && typeof value === 'string') result[attr] = new Date(value); else if (type === 'DecimalType' || type === 'NumberType') result[attr] = value == null ? value : Number(value); else result[attr] = value; } return result;
  }
}

let transactionId = 0;

class Oracle11TCL extends TCLAbstract {
  async begin() {
    if (this._adapter._activeTransaction) throw new AdapterError('Nested or concurrent Oracle transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    await this._adapter.connect();
    const connection = await this._adapter._pool.getConnection();
    const transaction = { id: ++transactionId, active: true, adapter: this._adapter, connection };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) { this._validateTransaction(transaction); try { await transaction.connection.commit(); } finally { this._release(transaction); } }
  async rollback(transaction) { this._validateTransaction(transaction); try { await transaction.connection.rollback(); } finally { this._release(transaction); } }

  _release(transaction) {
    transaction.active = false;
    transaction.connection.close();
    transaction.connection = null;
    this._adapter._activeTransaction = null;
  }
}

let oracleClient = null;

class Oracle11Adapter extends BaseAdapter {
  static defaultNaming = { 
    tables: 'snake_case', 
    columns: 'snake_case', 
    prefix: undefined, 
    caseStyle: 'upper',
    maxLength: 30
  };
  constructor(options = {}) {
    super({ fkStrategy: 'alter', ...options });
    this._pool = null; this._connectionOptions = this._normalizeConnectionOptions(options);
    this.ddl = new Oracle11DDL(this); this.dml = new Oracle11DML(this); this.dcl = null; this.tcl = new Oracle11TCL(this);
  }
  static async _loadClient() {
    if (!util.isDate) util.isDate = value => value instanceof Date;
    if (!oracleClient) oracleClient = await import('oracledb');
    return oracleClient.default || oracleClient;
  }

  async validateDependencies() {
    const client = await this._getClient();
    this._validateClientVersion(client);
    return true;
  }
  
  async connect() { 
    if (this._pool) return; 
    this._client = await this._getClient(); 
    this._pool = await this._client.createPool(this._connectionOptions); 
    this._log('info', 'conectado'); 
  }
  
  async authenticate() { 
    await this.connect(); 
    await this.dml._executeGet('SELECT 1 AS ok FROM dual'); 
    return true; 
  }
  
  async close() { 
    if (this._activeTransaction) await this.tcl.rollback(this._activeTransaction); 
    if (this._pool) { 
      await this._pool.close(0); 
      this._pool = null; 
      this._log('info', 'desconectado'); 
    } 
  }
  
  async initialize() { 
    if (!this._pool) await this.connect(); 
  }
  
  _connection() { 
    return this._activeTransaction?.connection || this._pool; 
  }
  
  async _withConnection(run) {
    if (this._activeTransaction) return run(this._activeTransaction.connection);
    const connection = await this._pool.getConnection();
    try { 
      return await run(connection); 
    } catch(e){
      throw Oracle11Error.from(e);
    }finally { 
      await connection.close(); 
    }
  }
  sequenceName(tableName) { const prefix = 'seq_'; const safe = String(tableName).replace(/[^A-Za-z0-9_$#]/g, '_'); return `${prefix}${safe}`.slice(0, 30); }

  mapDataType(dataType) {
    const name = dataType?.constructor?.name || String(dataType);
    switch (name) {
      case 'IntegerType': return 'NUMBER(10)';
      case 'DecimalType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 2})`;
      case 'NumberType': return `NUMBER(${dataType.options?.precision ?? 10}, ${dataType.options?.scale ?? 0})`;
      case 'StringType': return `VARCHAR2(${Math.min(dataType.options?.length ?? 255, 4000)})`;
      case 'BooleanType': return 'NUMBER(1)';
      case 'DateType': return 'DATE';
      case 'ArrayType': case 'ObjectType': case 'JSONType': return 'VARCHAR2(4000)';
      default: return 'VARCHAR2(4000)';
    }
  }
  cloneRecord(record) { return { ...record }; }
  async _getClient() { try { return await this.constructor._loadClient(); } catch (error) { const wrapped = Oracle11Error.missingDependency(error); this._dependencyWarning(wrapped.message); throw wrapped; } }
  _validateClientVersion(client) {
    const version = client?.versionString || this._versionNumberToString(client?.version);
    if (!version || this._compareVersions(version, '5.5.0') <= 0) return;
    const error = Oracle11Error.unsupportedDependencyVersion(version);
    this._dependencyWarning(error.message);
    throw error;
  }
  _versionNumberToString(version) {
    if (!Number.isInteger(version)) return null;
    const major = Math.floor(version / 10000);
    const minor = Math.floor((version % 10000) / 100);
    const patch = version % 100;
    return `${major}.${minor}.${patch}`;
  }
  _compareVersions(left, right) {
    const a = String(left).split('.').map(value => Number.parseInt(value, 10) || 0);
    const b = String(right).split('.').map(value => Number.parseInt(value, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  _dependencyWarning(message) { if (this._seq) this._log('error', message); else console.error(`[Seq] ${message}`); }
  _normalizeConnectionOptions(options) { const { naming, fkStrategy, eager, connectString, user, password, poolMin, poolMax, poolIncrement, ...rest } = options; return { user, password, connectString, poolMin: poolMin ?? 0, poolMax: poolMax ?? 4, poolIncrement: poolIncrement ?? 1, ...rest }; }
}

class Oracle12Adapter extends Oracle11Adapter {
}

export { AdapterError, Association, BaseAdapter, ConfigurationError, DataTypes, ErrorAbstract, MapAdapter, Model, ModelError, ModelRegistry, MySQLAdapter, MySQLError, Op, Oracle11Adapter, Oracle11Error, Oracle12Adapter, SQLiteAdapter, SQLiteError, Seq, SeqError, ValidationError };
//# sourceMappingURL=seq.js.map
