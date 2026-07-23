import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * Base TCL abstract.
 * Defines the full TCL contract and provides adapter-agnostic helpers.
 * Adapter-specific subclasses must override all public methods.
 */
export class TCLAbstract extends BaseAbstract {
  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Begins a new transaction.
   * @param {object} [options]
   * @returns {Promise<object>} Transaction object
   */
  async begin(options = {}) {
    throw new AdapterError('TCL begin is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  /**
   * Commits a transaction.
   * @param {object} transaction
   */
  async commit(transaction) {
    throw new AdapterError('TCL commit is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  /**
   * Rolls back a transaction.
   * @param {object} transaction
   */
  async rollback(transaction) {
    throw new AdapterError('TCL rollback is not implemented by this adapter', { code: 'SEQ_TCL_NOT_IMPLEMENTED' });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers — reusable by all adapter subclasses
  // ---------------------------------------------------------------------------

  /**
   * Validates that a transaction object is active.
   * @param {object} transaction
   * @throws {AdapterError} If transaction is not active or missing
   */
  _validateTransaction(transaction) {
    if (!transaction || !transaction.active || transaction.adapter !== this._adapter || this._adapter._activeTransaction !== transaction) {
      throw new AdapterError('Transaction is not active or already finished', {
        code: 'SEQ_ADAPTER_TRANSACTION_INVALID'
      });
    }
  }
}
