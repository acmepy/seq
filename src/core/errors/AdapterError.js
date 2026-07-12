import { SeqError } from './SeqError.js';

/**
 * Error thrown for adapter-related issues in Seq ORM.
 */
export class AdapterError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'AdapterError';
    this.code = options.code || 'SEQ_ADAPTER_ERROR';
  }
}
