import { ErrorAbstract } from '../abstract/ErrorAbstract.js';

export class MySQLError extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'MySQLError';
    this.code = options.code || 'SEQ_MYSQL_ERROR';
  }

  static missingDependency(dependency, cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

MySQLAdapter requiere la dependencia "${dependency}". Instalala con: npm install ${dependency}

-------------------------------------------------------------------------------------------------------------

`;
    return new MySQLError(message, {
      code: 'SEQ_MYSQL_MISSING_DEPENDENCY',
      details: { dependency },
      cause
    });
  }

  static from(error) {
    const constraintCodes = new Set([
      'ER_DUP_ENTRY',
      'ER_NO_REFERENCED_ROW',
      'ER_NO_REFERENCED_ROW_2',
      'ER_ROW_IS_REFERENCED',
      'ER_ROW_IS_REFERENCED_2',
      'ER_BAD_NULL_ERROR',
      'ER_CHECK_CONSTRAINT_VIOLATED'
    ]);
    if (!constraintCodes.has(error?.code)) return error;

    return new MySQLError(error.message, {
      code: 'SEQ_MYSQL_CONSTRAINT',
      details: {
        mysqlCode: error.code,
        errno: error.errno,
        sqlState: error.sqlState
      },
      cause: error
    });
  }
}
