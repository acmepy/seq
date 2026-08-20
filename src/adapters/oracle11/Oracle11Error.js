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

  static unsupportedDependencyVersion(version) {
    const message = `
-------------------------------------------------------------------------------------------------------------

Oracle11Adapter requiere la dependencia "oracledb" en version menor o igual a 5.5.0. Version instalada: ${version}.

-------------------------------------------------------------------------------------------------------------

`;
    return new Oracle11Error(message, {
      code: 'SEQ_ORACLE_UNSUPPORTED_DEPENDENCY_VERSION',
      details: { dependency: 'oracledb', version, maxVersion: '5.5.0' }
    });
  }

  static from(error) {
    const oracleCode = error?.code || (error?.errorNum ? `ORA-${String(error.errorNum).padStart(5, '0')}` : undefined);
    if (!['ORA-00001', 'ORA-02291', 'ORA-02292', 'ORA-01400'].includes(oracleCode)) return error;
    const type = oracleCode === 'ORA-00001' ? 'unique' : oracleCode === 'ORA-01400' ? 'notNull' : oracleCode === 'ORA-02291' ? 'foreignKey' : 'referenced';
    return new Oracle11Error(error.message, {
      status: 409, code: 'CONFLICT',
      details: { constraint: { adapter: 'oracle', type }, oracleCode }, cause: error
    });
  }
}
