import 'dotenv/config';
import assert from 'node:assert/strict';
import { Seq, SQLiteAdapter, MySQLAdapter } from '../../src/index.js';

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
    if (context.adapter?.constructor?.name === 'MySQLAdapter' && process.env.SEQ_MYSQL_KEEP_TABLES !== '1') {
      const prefixes = [
        `${testTablePrefix()}_`,
        `seqt_mysql_${process.pid.toString(36)}_`
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

function testTablePrefix() {
  if (testAdapterName() === 'mysql') return 'myt';
  return testAdapterName().replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 3).padEnd(3, 'x');
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive integer in milliseconds.`);
  return value;
}
