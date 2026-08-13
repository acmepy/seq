/**
 * Base error class for all Seq ORM errors.
 */
export class SeqError extends Error {
  /**
   * @param {string} message - Error message
 * @param {object} [options] - Error options
 * @param {number} [options.status] - HTTP-compatible status for integrations
 * @param {string} [options.code] - Error code
 * @param {*} [options.errors] - Field-level normalized errors
 * @param {*} [options.details] - Additional error details
 * @param {*} [options.cause] - Original cause
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SeqError';
    this.status = options.status || null;
    this.code = options.code || 'SEQ_ERROR';
    this.errors = options.errors || null;
    this.details = options.details || null;
  }
}
