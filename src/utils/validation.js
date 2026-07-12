/**
 * Checks if a value is empty (null or undefined).
 * @param {*} value
 * @returns {boolean}
 */
export function isEmpty(value) {
  return value === null || value === undefined;
}

/**
 * Validates that a value is not null when allowNull is false.
 * @param {*} value - The value to check
 * @param {string} fieldName - The field name for error messages
 * @param {boolean} allowNull - Whether null is allowed
 * @returns {{ valid: boolean, message: string }}
 */
export function checkAllowNull(value, fieldName, allowNull) {
  if (!allowNull && isEmpty(value)) {
    return {
      valid: false,
      message: `Field "${fieldName}" does not allow null values`
    };
  }
  return { valid: true, message: '' };
}
