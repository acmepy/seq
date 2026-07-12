import { ModelError } from './errors/ModelError.js';

/**
 * Central registry for models in a Seq instance.
 */
export class ModelRegistry {
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
    if (modelClass.tableName) {
      if (this._tableNames.has(modelClass.tableName)) {
        throw new ModelError(
          `Table name "${modelClass.tableName}" is already used by model "${this._tableNames.get(modelClass.tableName)}"`,
          { code: 'SEQ_MODEL_DUPLICATE_TABLE' }
        );
      }
      this._tableNames.set(modelClass.tableName, name);
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
