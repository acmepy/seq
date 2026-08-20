import 'dotenv/config';
import assert from 'node:assert/strict';
import { Seq, SQLiteAdapter, MySQLAdapter, Oracle11Adapter, Oracle12Adapter } from '../../src/index.js';

let tableCounter = 0;

export function testAdapterName() {
  return process.env.SEQ_TEST_ADAPTER || 'sqlite';
}

export function testTable(base) {
  if (testAdapterName() === 'sqlite') return base;
  tableCounter++;
  return `${testTablePrefix()}_${tableCounter.toString(36)}_${base}`;
}

export function quoteTestIdentifier(name) {
  return testAdapterName() === 'mysql'
    ? `\`${name.replaceAll('`', '``')}\``
    : `"${name.replaceAll('"', '""')}"`;
}

export async function createTestContext({ models = [], logging = false, adapterOptions = {} } = {}) {
  const adapter = createTestAdapter(adapterOptions);
  const seq = new Seq({ adapter, models, logging });
  await seq.init();
  return { adapter, seq, models };
}

export async function cleanupTestContext(context) {
  if (!context) return;

  try {
    if (['MySQLAdapter', 'Oracle11Adapter', 'Oracle12Adapter'].includes(context.adapter?.constructor?.name) && !keepTestTables()) {
      const prefixes = [
        `${testTablePrefix()}_`,
        `seqt_mysql_${process.pid.toString(36)}_`,
        `seqt_oracle_${process.pid.toString(36)}_`
      ];
      const tables = await context.adapter.ddl.listTables();
      for (const table of tables.filter(name => prefixes.some(prefix => name.startsWith(prefix)))) {
        await context.adapter.ddl.dropTable(table, { ifExists: true, ignoreForeignKeys: true });
      }
      for (const model of [...context.models].reverse()) {
        if (model.tableName) await context.adapter.ddl.dropTable(model.tableName, { ifExists: true, ignoreForeignKeys: true });
      }
    }
  } finally {
    await context.seq.close();
  }
}

export function createTestAdapter(options = {}) {
  if (testAdapterName() === 'sqlite') {
    return new SQLiteAdapter({ database: ':memory:', ...options });
  }

  if (testAdapterName() === 'mysql') {
    const baseOptions = mysqlOptions();
    return new MySQLAdapter({
      ...baseOptions,
      ...options,
      naming: {
        ...(baseOptions.naming || {}),
        ...(options.naming || {})
      }
    });
  }

  if (testAdapterName() === 'oracle11' || testAdapterName() === 'oracle12') {
    const baseOptions = oracleOptions();
    const Adapter = testAdapterName() === 'oracle12' ? Oracle12Adapter : Oracle11Adapter;
    return new Adapter({
      ...baseOptions,
      ...options,
      naming: { ...(baseOptions.naming || {}), ...(options.naming || {}) }
    });
  }

  throw new Error(`Unsupported SEQ_TEST_ADAPTER "${testAdapterName()}"`);
}

export function mysqlTestOptions() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];
  for (const name of required) {
    assert.ok(process.env[name], `Missing ${name}. Copy .env.example to .env and set MySQL test credentials.`);
  }

  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    connectTimeout: readPositiveIntegerEnv('MYSQL_CONNECT_TIMEOUT', 10000),
    connectionLimit: 2,
    naming: { prefix: testTablePrefix() }
  };
}

function mysqlOptions() {
  return mysqlTestOptions();
}

export function oracleTestOptions() {
  const required = ['ORACLE_USER', 'ORACLE_CONNECT_STRING'];
  for (const name of required) assert.ok(process.env[name], `Missing ${name}. Copy .env.example to .env and set Oracle test credentials.`);
  return {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD || '',
    connectString: process.env.ORACLE_CONNECT_STRING,
    connectTimeout: readPositiveIntegerEnv('ORACLE_CONNECT_TIMEOUT', 10),
    poolMin: 0,
    poolMax: 2,
    naming: { prefix: testTablePrefix() }
  };
}

function oracleOptions() { return oracleTestOptions(); }

function testTablePrefix() {
  if (testAdapterName() === 'mysql') return 'myt';
  if (testAdapterName() === 'oracle11') return 'o11';
  if (testAdapterName() === 'oracle12') return 'o12';
  return testAdapterName().replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 3).padEnd(3, 'x');
}

function keepTestTables() {
  return process.env.SEQ_MYSQL_KEEP_TABLES === '1' || process.env.SEQ_ORACLE_KEEP_TABLES === '1';
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive integer in milliseconds.`);
  return value;
}
