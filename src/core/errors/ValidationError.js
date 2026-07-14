import { SeqError } from './SeqError.js';

/**
 * Error thrown for validation issues in Seq ORM.
 */
export class ValidationError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ValidationError';
    this.code = options.code || 'SEQ_VALIDATION_ERROR';
  }
}

export class ValidationWhereError extends ValidationError{
  constructor(message, options = {}){
    super('where must be an object', { code: 'SEQ_VALIDATION_WHERE', ...options })
  }
}

export class ValidationOrderError extends ValidationError{
  constructor(message, options = {}){
    super('order must be an array', { code: 'SEQ_VALIDATION_ORDER', ...options })
  }
}

export class ValidationLimitError extends ValidationError{
  constructor(message, options = {}){
    super('limit must be an integer >= 1', { code: 'SEQ_VALIDATION_LIMIT', ...options })
  }
}

export class ValidationOffsetError extends ValidationError{
  constructor(message, options = {}){
    super('offset must be an integer >= 0', { code: 'SEQ_VALIDATION_OFFSET', ...options })
  }
}