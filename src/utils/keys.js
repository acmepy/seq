import { Op } from '../operators.js';

export function primaryAttributes(model) {
  return model.primaryKeyAttributes || (model.primaryKeyAttribute ? [model.primaryKeyAttribute] : []);
}

export function valuesFor(record, attributes) {
  return attributes.map(attribute => typeof record.getDataValue === 'function' ? record.getDataValue(attribute) : record[attribute]);
}

export function keyObject(attributes, values) {
  return Object.fromEntries(attributes.map((attribute, index) => [attribute, values[index]]));
}

export function tupleKey(values) {
  return JSON.stringify(values.map(value => typeof value === 'bigint' ? ['bigint', String(value)] : value));
}

export function tuplesWhere(attributes, tuples) {
  if (attributes.length === 1) return { [attributes[0]]: { [Op.in]: tuples.map(tuple => tuple[0]) } };
  return { [Op.or]: tuples.map(tuple => keyObject(attributes, tuple)) };
}
