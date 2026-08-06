/**
 * Creates a deep clone of a value while preserving model instances.
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
  if (Array.isArray(value)) {
    return value.map(item => clone(item));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) {
      return value;
    }
    const cloned = {};
    for (const [key, child] of Object.entries(value)) {
      cloned[key] = clone(child);
    }
    return cloned;
  }
  return value;
}
