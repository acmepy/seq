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

    const fields = constraintFields(error);
    const type = constraintType(error.code);
    return new MySQLError(error.message, {
      status: 409,
      code: 'CONFLICT',
      errors: constraintErrors(fields, type),
      details: {
        constraint: { adapter: 'mysql', type, fields, name: constraintName(error) },
        mysqlCode: error.code,
        errno: error.errno,
        sqlState: error.sqlState
      },
      cause: error
    });
  }
}

function constraintFields(error) {
  if (error?.code === 'ER_BAD_NULL_ERROR') return [error.message?.match(/Column '([^']+)' cannot be null/i)?.[1]].filter(Boolean);

  const keyName = constraintName(error);
  if (!keyName) return [];

  const field = keyName.startsWith('uk_') ? keyName.split('_').pop() : keyName;
  return [field].filter(Boolean);
}

function constraintName(error) {
  return error?.message?.match(/for key ['"`](?:.+\.)?([^'"`]+)['"`]/i)?.[1] || null;
}

function constraintType(code) {
  if (code === 'ER_DUP_ENTRY') return 'unique';
  if (code === 'ER_BAD_NULL_ERROR') return 'notNull';
  if (code === 'ER_NO_REFERENCED_ROW' || code === 'ER_NO_REFERENCED_ROW_2') return 'foreignKey';
  if (code === 'ER_ROW_IS_REFERENCED' || code === 'ER_ROW_IS_REFERENCED_2') return 'referenced';
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') return 'check';
  return 'constraint';
}

function constraintErrors(fields, type) {
  if (!fields.length) return null;
  const message = type === 'notNull' ? 'Requerido' : 'Ya existe un registro con este valor';
  return Object.fromEntries(fields.map(field => [field, message]));
}
