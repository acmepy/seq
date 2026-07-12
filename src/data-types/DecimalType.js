import { NumberType } from './NumberType.js';

/**
 * Represents a decimal/numeric data type with precision and scale.
 * Extends NumberType with a different default scale.
 */
export class DecimalType extends NumberType {
  /**
   * @param {number} [precision=10] - Total number of digits
   * @param {number} [scale=2] - Number of digits after decimal point
   */
  constructor(precision = 10, scale = 2) {
    super(precision, scale);
    this.key = 'DECIMAL';
  }
}
