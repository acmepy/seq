import { ErrorAbstract } from '../abstract/ErrorAbstract.js';

export class Oracle11Error extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'Oracle11Error';
    this.code = options.code || 'SEQ_ORACLE_ERROR';
  }

  static missingDependency(cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

Oracle11Adapter requiere la dependencia "oracledb". Instalala con: npm install oracledb

-------------------------------------------------------------------------------------------------------------

`;
    return new Oracle11Error(message, {
      code: 'SEQ_ORACLE_MISSING_DEPENDENCY', details: { dependency: 'oracledb' }, cause
    });
  }

  static from(error) {
    if (!['ORA-00001', 'ORA-02291', 'ORA-02292', 'ORA-01400'].includes(error?.code)) return error;
    const type = error.code === 'ORA-00001' ? 'unique' : error.code === 'ORA-01400' ? 'notNull' : error.code === 'ORA-02291' ? 'foreignKey' : 'referenced';
    return new Oracle11Error(error.message, {
      status: 409, code: 'CONFLICT',
      details: { constraint: { adapter: 'oracle', type }, oracleCode: error.code }, cause: error
    });
  }
}
