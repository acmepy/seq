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
