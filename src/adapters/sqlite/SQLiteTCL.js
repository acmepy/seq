import { TCLAbstract } from '../abstract/TCLAbstract.js';

let transactionIdCounter = 0;

export class SQLiteTCL extends TCLAbstract {
  constructor(adapter) {
    super(adapter);
  }

  _db() {
    return this._adapter._db;
  }

  async _execute(sql, params = []) {
    this._db().prepare(sql).run(...params);
  }

  async begin(options = {}) {
    this._execute('BEGIN IMMEDIATE');
    return {
      id: ++transactionIdCounter,
      active: true
    };
  }

  async commit(transaction) {
    this._validateTransaction(transaction);
    this._execute('COMMIT');
    transaction.active = false;
  }

  async rollback(transaction) {
    this._validateTransaction(transaction);
    this._execute('ROLLBACK');
    transaction.active = false;
  }
}
