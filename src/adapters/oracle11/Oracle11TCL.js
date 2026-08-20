import { TCLAbstract } from '../abstract/TCLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

let transactionId = 0;

export class Oracle11TCL extends TCLAbstract {
  async begin() {
    if (this._adapter._activeTransaction) throw new AdapterError('Nested or concurrent Oracle transactions are not supported', { code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT' });
    await this._adapter.connect();
    const connection = await this._adapter._pool.getConnection();
    const transaction = { id: ++transactionId, active: true, adapter: this._adapter, connection };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) { this._validateTransaction(transaction); try { await transaction.connection.commit(); } finally { this._release(transaction); } }
  async rollback(transaction) { this._validateTransaction(transaction); try { await transaction.connection.rollback(); } finally { this._release(transaction); } }

  _release(transaction) {
    transaction.active = false;
    transaction.connection.close();
    transaction.connection = null;
    this._adapter._activeTransaction = null;
  }
}
