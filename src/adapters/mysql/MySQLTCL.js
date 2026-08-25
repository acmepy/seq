import { TCLAbstract } from '../abstract/TCLAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

let transactionIdCounter = 0;

export class MySQLTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  async begin(options = {}) {
    if (this._adapter._activeTransaction) {
      throw new AdapterError('Nested or concurrent MySQL transactions are not supported', {
        code: 'SEQ_ADAPTER_TRANSACTION_CONCURRENT'
      });
    }

    const connection = await this._adapter._acquireConnection();
    try {
      await connection.beginTransaction();
    } catch (error) {
      connection.release();
      throw error;
    }
    const transaction = {
      id: ++transactionIdCounter,
      active: true,
      adapter: this._adapter,
      connection
    };
    this._adapter._activeTransaction = transaction;
    return transaction;
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    try {
      await transaction.connection.commit();
    } finally {
      this._release(transaction);
    }
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    try {
      await transaction.connection.rollback();
    } finally {
      this._release(transaction);
    }
  }

  _release(transaction) {
    transaction.active = false;
    transaction.connection.release();
    transaction.connection = null;
    this._adapter._activeTransaction = null;
  }
}
