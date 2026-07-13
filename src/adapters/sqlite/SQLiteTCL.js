import { TCLAbstract } from '../abstract/TCLAbstract.js';

let transactionIdCounter = 0;

export class SQLiteTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async begin(options = {}) {
    this._db().prepare('BEGIN IMMEDIATE').run();
    return {
      id: ++transactionIdCounter,
      active: true
    };
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    this._db().prepare('COMMIT').run();
    transaction.active = false;
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    this._db().prepare('ROLLBACK').run();
    transaction.active = false;
  }
}
