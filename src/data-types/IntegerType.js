import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents an integer data type.
 */
export class IntegerType extends AbstractDataType {
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
