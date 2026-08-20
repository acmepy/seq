import { Oracle11Adapter } from '../oracle11/Oracle11Adapter.js';
import { Oracle12DDL } from './Oracle12DDL.js';
import { Oracle12DML } from './Oracle12DML.js';

export class Oracle12Adapter extends Oracle11Adapter {
  constructor(options = {}) { super(options); this.ddl = new Oracle12DDL(this); this.dml = new Oracle12DML(this); }
}
