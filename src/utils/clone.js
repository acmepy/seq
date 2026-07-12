/**
 * Creates a deep clone of a value using structured clone.
 * @param {*} value - The value to clone
 * @returns {*} A deep clone of the value
 */
export function clone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  return structuredClone(value);
}
