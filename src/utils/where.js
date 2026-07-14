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
