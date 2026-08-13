import 'dotenv/config';
import { Seq, MySQLAdapter } from '../../src/index.js';
import { runAdapterSuite } from '../shared/adapter-suite.js';
import { mysqlTestOptions } from '../shared/test-context.js';

async function assertMySQLAuthentication() {
  const adapter = new MySQLAdapter(mysqlTestOptions());
  try {
    await adapter.authenticate();
  } catch (error) {
    throw new Error('MySQL authentication failed before running adapter suite', { cause: error });
  } finally {
    await adapter.close();
  }
}

async function cleanupMySQL({ adapter }) {
  if (process.env.SEQ_MYSQL_KEEP_TABLES === '1') return;

  const tables = await adapter.ddl.listTables();
  const prefixes = ['adt_', 'seqa_mysql_'];
  for (const table of tables.filter(name => prefixes.some(prefix => name.startsWith(prefix)))) {
    await adapter.ddl.dropTable(table, { ifExists: true, ignoreForeignKeys: true });
  }
}

await assertMySQLAuthentication();

runAdapterSuite({
  name: 'MySQL',
  createSeq({ models }) {
    const adapter = new MySQLAdapter({
      ...mysqlTestOptions(),
      naming: { prefix: 'adt' }
    });
    const seq = new Seq({ adapter, models, logging: false });
    return { seq, adapter };
  },
  cleanup: cleanupMySQL
});
