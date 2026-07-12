/**
 * Abstract base class for all Seq data types.
 * Concrete database types should be resolved by adapters.
 */
export class AbstractDataType {
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
