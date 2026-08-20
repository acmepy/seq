import { Oracle11DML } from '../oracle11/Oracle11DML.js';
import { ValidationError } from '../../core/errors/ValidationError.js';

export class Oracle12DML extends Oracle11DML {
  _usesSequenceForAutoIncrement() { return false; }
  _applyLimitOffset(sql, options) {
    const { limit, offset = 0 } = options;
    if (limit === undefined && options.offset === undefined) return sql;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ValidationError('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT' });
    if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET' });
    if (limit === undefined) return `${sql} OFFSET ${offset} ROWS`;
    return `${sql} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }
}
