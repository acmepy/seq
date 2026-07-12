import { SeqError } from './SeqError.js';

/**
 * Error thrown for model-related issues in Seq ORM.
 */
export class ModelError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ModelError';
    this.code = options.code || 'SEQ_MODEL_ERROR';
  }
}
