import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents a string/varchar data type with configurable length.
 */
export class StringType extends AbstractDataType {
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
