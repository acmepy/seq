import 'dotenv/config';
import { Seq, Oracle11Adapter, Oracle12Adapter } from '../../src/index.js';
import { runAdapterSuite } from '../shared/adapter-suite.js';
import { oracleTestOptions } from '../shared/test-context.js';

const version = process.env.SEQ_TEST_ADAPTER;
const Adapter = version === 'oracle12' ? Oracle12Adapter : Oracle11Adapter;
const name = version === 'oracle12' ? 'Oracle 12' : 'Oracle 11';
const prefix = version === 'oracle12' ? 'adt12' : 'adt11';

async function assertOracleAuthentication() {
  const adapter = new Adapter(oracleTestOptions());
  try { await adapter.authenticate(); }
  catch (error) {
    const code = error?.code ? ` (${error.code})` : '';
    throw new Error(`${name} authentication failed before running adapter suite${code}: ${error?.message || error}`, { cause: error });
  }
  finally { await adapter.close(); }
}

async function cleanupOracle({ adapter }) {
  if (process.env.SEQ_ORACLE_KEEP_TABLES === '1') return;
  const tables = await adapter.ddl.listTables();
  const prefixes = [prefix, prefix.toUpperCase(), 'adt', 'ADT'];
  for (const table of tables.filter(item => prefixes.some(value => item.startsWith(value)))) {
    await adapter.ddl.dropTable(table, { ifExists: true, ignoreForeignKeys: true });
  }
}

await assertOracleAuthentication();

runAdapterSuite({
  name,
  createSeq({ models }) {
    const adapter = new Adapter({ ...oracleTestOptions(), naming: { prefix } });
    return { seq: new Seq({ adapter, models, logging: false }), adapter };
  },
  cleanup: cleanupOracle
});
