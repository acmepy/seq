/**
 * Converts a PascalCase or camelCase name to snake_case.
 * @param {string} name
 * @returns {string}
 */
export function toSnakeCase(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Derives a table name from a model name.
 * @param {string} modelName
 * @returns {string}
 */
export function deriveTableName(modelName) {
  return toSnakeCase(modelName) + 's';
}
