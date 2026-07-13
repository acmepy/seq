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
 * Converts a snake_case or PascalCase name to camelCase.
 * @param {string} name
 * @returns {string}
 */
export function toCamelCase(name) {
  return name
    .replace(/[-_]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/**
 * Applies a naming convention to a name.
 * @param {string} name - The original name
 * @param {string} [convention] - 'camelCase' | 'snake_case' | undefined (no transform)
 * @returns {string}
 */
export function applyConvention(name, convention) {
  if (!convention) return name;
  if (convention === 'snake_case') return toSnakeCase(name);
  if (convention === 'camelCase') return toCamelCase(name);
  return name;
}

/**
 * Applies the adapter's case style to a name.
 * @param {string} name - The name to transform
 * @param {string} [caseStyle] - 'upper' | 'lower' | undefined (no transform)
 * @returns {string}
 */
export function applyCase(name, caseStyle) {
  if (!caseStyle) return name;
  if (caseStyle === 'upper') return name.toUpperCase();
  if (caseStyle === 'lower') return name.toLowerCase();
  return name;
}

/**
 * Derives a table name from a model name.
 * @param {string} modelName
 * @returns {string}
 */
export function deriveTableName(modelName) {
  return toSnakeCase(modelName) + 's';
}
