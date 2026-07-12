/**
 * Base error class for all Seq ORM errors.
 */
export class SeqError extends Error {
  /**
   * @param {string} message - Error message
   * @param {object} [options] - Error options
   * @param {string} [options.code] - Error code
   * @param {*} [options.details] - Additional error details
   * @param {*} [options.cause] - Original cause
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SeqError';
    this.code = options.code || 'SEQ_ERROR';
    this.details = options.details || null;
  }
}
