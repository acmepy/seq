import { Op } from '../operators.js';

/**
 * Resolves a where clause value into { op, value }.
 * Scalar values → Op.eq.
 * Objects with a single Symbol key → that operator.
 * @param {*} value
 * @returns {{ op: symbol, value: * }}
 */
export function resolveWhereValue(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length === 1) {
      return { op: symbols[0], value: value[symbols[0]] };
    }
  }
  return { op: Op.eq, value };
}

export function isPlainWhereObject(where) {
  return Boolean(where) && typeof where === 'object' && !Array.isArray(where);
}

/**
 * Returns true when a where object contains at least one effective predicate.
 * @param {*} where
 * @returns {boolean}
 */
export function hasEffectiveWhere(where) {
  if (!isPlainWhereObject(where)) return false;
  if (Object.keys(where).length > 0) return true;
  for (const sym of Object.getOwnPropertySymbols(where)) {
    if (sym !== Op.and && sym !== Op.or) return true;
    const children = where[sym];
    if (!Array.isArray(children)) return true;
    if (children.some(child => hasEffectiveWhere(child))) return true;
  }
  return false;
}
