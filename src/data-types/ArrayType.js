import { AbstractDataType } from './AbstractDataType.js';

/**
 * Represents an array data type with optional item type validation.
 */
export class ArrayType extends AbstractDataType {
  /**
   * @param {AbstractDataType|null} [itemType=null] - Type to validate each element against
   */
  constructor(itemType = null) {
    super('ARRAY', itemType ? { itemType } : {});
    this._itemType = itemType;
  }

  /**
   * Validates that a value is an array, and optionally validates each element.
   * @param {*} value
   * @returns {{ valid: boolean, message: string }}
   */
  validate(value) {
    if (value === null || value === undefined) {
      return { valid: true, message: '' };
    }
    if (!Array.isArray(value)) {
      return { valid: false, message: `Expected an array, got ${typeof value}` };
    }
    if (this._itemType) {
      for (let i = 0; i < value.length; i++) {
        const result = this._itemType.validate(value[i]);
        if (!result.valid) {
          return {
            valid: false,
            message: `Item at index ${i}: ${result.message}`
          };
        }
      }
    }
    return { valid: true, message: '' };
  }
}
