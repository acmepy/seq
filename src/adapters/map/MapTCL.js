import { TCLAbstract } from '../abstract/TCLAbstract.js';
import { clone } from '../../utils/clone.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * Transaction ID counter.
 */
let transactionIdCounter = 0;

/**
 * TCL operations for the MapAdapter.
 *
 * Extends TCLStatements which provides _validateTransaction.
 *
 * Transaction strategy:
 * - begin: snapshot all main tables and sequences
 * - commit: discard snapshots (changes already in main tables)
 * - rollback: restore main tables and sequences from snapshots
 *
 * DML operations always write directly to the main tables.
 * This is a simple optimistic approach suitable for an in-memory adapter.
 */
export class MapTCL extends TCLAbstract {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    super(adapter);
  }

  /**
   * Begins a new transaction.
   * Creates snapshots of all tables and sequences for potential rollback.
   * @param {object} [options]
   * @returns {Promise<object>} Transaction object
   */
  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent Map transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    }
    const transaction = {
      id: ++transactionIdCounter,
      active: true,
      adapter: this._adapter,
      baseDatabase: this._adapter.database,
      baseSequences: this._adapter.sequences
    };
    this._adapter.database = this._cloneDatabase(this._adapter.database);
    this._adapter.sequences = new Map(this._adapter.sequences);
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  /**
   * Commits a transaction.
   * Discards snapshots; changes are already applied to the main tables.
   * @param {object} transaction
   */
  async commit(transaction) {
    this._validateTransaction(transaction);
    transaction.active = false;
    transaction.baseDatabase = null;
    transaction.baseSequences = null;
    this._adapter._activeTransaction = null;
  }

  /**
   * Rolls back a transaction.
   * Restores the database from snapshots taken at begin.
   * @param {object} transaction
   */
  async rollback(transaction) {
    this._validateTransaction(transaction);

    this._adapter.database = transaction.baseDatabase;
    this._adapter.sequences = transaction.baseSequences;
    transaction.active = false;
    transaction.baseDatabase = null;
    transaction.baseSequences = null;
    this._adapter._activeTransaction = null;
  }

  _cloneDatabase(database) {
    const result = new Map();
    for (const [tableName, table] of database) {
      result.set(tableName, new Map([...table].map(([key, record]) => [key, clone(record)])));
    }
    return result;
  }
}
