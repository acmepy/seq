import { ErrorAbstract } from '../abstract/ErrorAbstract.js';

export class SQLiteError extends ErrorAbstract {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'SQLiteError';
    this.code = options.code || 'SEQ_SQLITE_ERROR';
  }

  static missingDependency(dependency, cause) {
    const message = `
-------------------------------------------------------------------------------------------------------------

SQLiteAdapter requiere la dependencia "${dependency}". Instalala con: npm install ${dependency}

-------------------------------------------------------------------------------------------------------------

`;
    return new SQLiteError(message, {
      code: 'SEQ_SQLITE_MISSING_DEPENDENCY',
      details: { dependency },
      cause
    });
  }

  static from(error) {
    if (!String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return error;

    const name = /^(.*? constraint failed)(?::|$)/i.exec(error.message || '')?.[1] || 'SQLITE_CONSTRAINT';
    const fields = constraintFields(error.message);
    const type = constraintType(error.code);
    return new SQLiteError(error.message, {
      status: 409,
      code: 'CONFLICT',
      errors: constraintErrors(fields, type),
      details: {
        constraint: { adapter: 'sqlite', type, fields, name },
        sqliteCode: error.code
      },
      cause: error
    });
  }
}

function constraintFields(message = '') {
  return message.match(/(?:UNIQUE|NOT NULL) constraint failed: (.+)$/)?.[1]
    ?.split(',')
    .map(field => field.trim().split('.').pop())
    .filter(Boolean) || [];
}

function constraintType(code) {
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return 'unique';
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'notNull';
  return 'constraint';
}

function constraintErrors(fields, type) {
  if (!fields.length) return null;
  const message = type === 'notNull' ? 'Requerido' : 'Ya existe un registro con este valor';
  return Object.fromEntries(fields.map(field => [field, message]));
}
