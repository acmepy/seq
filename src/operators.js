/**
 * Query operators for where clauses.
 * Usage: { [Op.like]: '%ana%' }, { [Op.in]: [1, 2, 3] }
 */
export const Op = {
  eq:           Symbol.for('seq.Op.eq'),
  ne:           Symbol.for('seq.Op.ne'),
  gt:           Symbol.for('seq.Op.gt'),
  gte:          Symbol.for('seq.Op.gte'),
  lt:           Symbol.for('seq.Op.lt'),
  lte:          Symbol.for('seq.Op.lte'),
  like:         Symbol.for('seq.Op.like'),
  notLike:      Symbol.for('seq.Op.notLike'),
  in:           Symbol.for('seq.Op.in'),
  notIn:        Symbol.for('seq.Op.notIn'),
  between:      Symbol.for('seq.Op.between'),
  notBetween:   Symbol.for('seq.Op.notBetween'),
  and:          Symbol.for('seq.Op.and'),
  or:           Symbol.for('seq.Op.or'),
};
