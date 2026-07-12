import { SeqError } from './SeqError.js';

/**
 * Error thrown for configuration issues in Seq ORM.
 */
export class ConfigurationError extends SeqError {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConfigurationError';
    this.code = options.code || 'SEQ_CONFIGURATION_ERROR';
  }
}
