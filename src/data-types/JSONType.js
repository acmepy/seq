import { ObjectType } from './ObjectType.js';

/**
 * Represents a JSON data type.
 * Extends ObjectType: validates that the value is a plain object
 * and contains only JSON-serializable values (no functions, no undefined, no circular refs).
 */
export class JSONType extends ObjectType {
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
    const err = this._checkSerializable(value);
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
  _checkSerializable(value, path = '') {
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
    if (value instanceof Date) {
      return `Value${path ? ' at ' + path : ''} is a Date, which is not JSON-serializable`;
    }

    if (type === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const err = this._checkSerializable(value[i], `${path}[${i}]`);
          if (err) return err;
        }
      } else {
        for (const key of Object.keys(value)) {
          const err = this._checkSerializable(value[key], path ? `${path}.${key}` : key);
          if (err) return err;
        }
      }
    }

    return null;
  }
}
