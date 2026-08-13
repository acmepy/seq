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
    return new SQLiteError(error.message, {
      code: 'SEQ_SQLITE_CONSTRAINT',
      details: { name, sqliteCode: error.code },
      cause: error
    });
  }
}
