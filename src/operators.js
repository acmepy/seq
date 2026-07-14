/**
 * Query operators for where clauses.
 * Usage: { [Op.like]: '%ana%' }, { [Op.in]: [1, 2, 3] }
 */
export const Op = {
  eq:           Symbol('eq'),
  ne:           Symbol('ne'),
  gt:           Symbol('gt'),
  gte:          Symbol('gte'),
  lt:           Symbol('lt'),
  lte:          Symbol('lte'),
  like:         Symbol('like'),
  notLike:      Symbol('notLike'),
  in:           Symbol('in'),
  notIn:        Symbol('notIn'),
  between:      Symbol('between'),
  notBetween:   Symbol('notBetween'),
  and:          Symbol('and'),
  or:           Symbol('or'),
};
