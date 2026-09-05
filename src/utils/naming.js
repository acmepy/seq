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
 * Converts the first character of a string to uppercase.
 * @param {string} name
 * @returns {string}
 */
export function initCap(name) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Truncates a string to a maximum length while preserving both ends.
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateMiddle(name, maxLength) {
  const value = String(name);
  if (!maxLength || value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);

  const keep = maxLength - 1;
  const headLength = Math.ceil(keep / 2);
  const tailLength = Math.floor(keep / 2);
  return `${value.slice(0, headLength)}_${value.slice(value.length - tailLength)}`;
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

