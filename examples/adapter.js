import { Oracle11Adapter, Oracle12Adapter, SQLiteAdapter } from '../src/index.js';

/**
 * Select with SEQ_EXAMPLE_ADAPTER=sqlite|oracle11|oracle12.
 * Oracle credentials are read from ORACLE_USER, ORACLE_PASSWORD and ORACLE_CONNECT_STRING.
 */
export function createExampleAdapter({ database = ':memory:' } = {}) {
  const dialect = process.env.SEQ_EXAMPLE_ADAPTER || 'sqlite';
  if (dialect === 'sqlite') return new SQLiteAdapter({ database });
  if (dialect === 'oracle11' || dialect === 'oracle12') {
    const Adapter = dialect === 'oracle12' ? Oracle12Adapter : Oracle11Adapter;
    return new Adapter({
      user: requiredEnv('ORACLE_USER'),
      password: process.env.ORACLE_PASSWORD || '',
      connectString: requiredEnv('ORACLE_CONNECT_STRING'),
      connectTimeout: Number(process.env.ORACLE_CONNECT_TIMEOUT || 10)
    });
  }
  throw new Error(`Unsupported SEQ_EXAMPLE_ADAPTER "${dialect}". Use sqlite, oracle11, or oracle12.`);
}

function requiredEnv(name) {
  if (process.env[name]) return process.env[name];
  throw new Error(`${name} is required when running an Oracle example.`);
}
