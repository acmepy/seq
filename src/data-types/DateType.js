import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents a date data type.
 */
export class DateType extends AbstractDataType {
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
