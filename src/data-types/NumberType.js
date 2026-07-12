import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents a number data type with precision and scale.
 * Alias for DecimalType with different default behavior.
 */
export class NumberType extends AbstractDataType {
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
