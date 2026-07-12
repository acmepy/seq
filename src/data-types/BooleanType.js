import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents a boolean data type.
 */
export class BooleanType extends AbstractDataType {
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
