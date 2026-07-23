import { TCLAbstract } from '../abstract/TCLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

let transactionIdCounter = 0;

export class SQLiteTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async _execute(sql, params = []) {
    this._log('trace', sql, params);
    this._db().prepare(sql).run(...params);
  }

  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent SQLite transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    }
    this._execute('BEGIN IMMEDIATE');
    const transaction = {
      id: ++transactionIdCounter,
      active: true,
      adapter: this._adapter
    };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    this._execute('COMMIT');
    transaction.active = false;
    this._adapter._activeTransaction = null;
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    this._execute('ROLLBACK');
    transaction.active = false;
    this._adapter._activeTransaction = null;
  }
}
