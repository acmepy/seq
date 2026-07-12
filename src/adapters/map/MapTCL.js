import { AdapterError } from '../../core/errors/AdapterError.js';
import { clone } from '../../utils/clone.js';

/**
 * Transaction ID counter.
 */
let transactionIdCounter = 0;

/**
 * TCL operations for the MapAdapter.
 *
 * Transaction strategy:
 * - begin: snapshot all main tables and sequences
 * - commit: discard snapshots (changes already in main tables)
 * - rollback: restore main tables and sequences from snapshots
 *
 * DML operations always write directly to the main tables.
 * This is a simple optimistic approach suitable for an in-memory adapter.
 */
export class MapTCL {
  /**
   * @param {import('./MapAdapter.js').MapAdapter} adapter
   */
  constructor(adapter) {
    this._adapter = adapter;
  }

  /**
   * Begins a new transaction.
   * Creates snapshots of all tables and sequences for potential rollback.
   * @param {object} [options]
   * @returns {Promise<object>} Transaction object
   */
  async begin(options = {}) {
    const transaction = {
      id: ++transactionIdCounter,
      active: true,
      snapshots: new Map(),
      sequences: new Map()
    };

    // Snapshot all tables (deep copy)
    for (const [tableName, table] of this._adapter.database) {
      const snapshot = new Map();
      for (const [key, record] of table) {
        snapshot.set(key, clone(record));
      }
      transaction.snapshots.set(tableName, snapshot);
    }

    // Snapshot sequences
    for (const [tableName, seq] of this._adapter.sequences) {
      transaction.sequences.set(tableName, seq);
    }

    return transaction;
  }

  /**
   * Commits a transaction.
   * Discards snapshots; changes are already applied to the main tables.
   * @param {object} transaction
   */
  async commit(transaction) {
    if (!transaction || !transaction.active) {
      throw new AdapterError('Transaction is not active or already finished', {
        code: 'SEQ_ADAPTER_TRANSACTION_INVALID'
      });
    }
    transaction.active = false;
    transaction.snapshots.clear();
    transaction.sequences.clear();
  }

  /**
   * Rolls back a transaction.
   * Restores the database from snapshots taken at begin.
   * @param {object} transaction
   */
  async rollback(transaction) {
    if (!transaction || !transaction.active) {
      throw new AdapterError('Transaction is not active or already finished', {
        code: 'SEQ_ADAPTER_TRANSACTION_INVALID'
      });
    }

    // Restore all tables from snapshots
    for (const [tableName, snapshot] of transaction.snapshots) {
      this._adapter.database.set(tableName, snapshot);
    }

    // Restore sequences
    for (const [tableName, seq] of transaction.sequences) {
      this._adapter.sequences.set(tableName, seq);
    }

    transaction.active = false;
    transaction.snapshots.clear();
    transaction.sequences.clear();
  }
}
