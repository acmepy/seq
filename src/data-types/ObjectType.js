import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents a plain object data type.
 * Accepts plain objects; rejects arrays, Dates, null, and other non-plain values.
 */
export class ObjectType extends AbstractDataType {
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
