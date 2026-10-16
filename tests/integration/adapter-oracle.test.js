import 'dotenv/config';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataTypes, Model, Seq, Oracle11Adapter, Oracle12Adapter } from '../../src/index.js';
import { runAdapterSuite } from '../shared/adapter-suite.js';
import { cleanupTestContext, createTestContext, oracleTestOptions, quoteTestIdentifier, testTable } from '../shared/test-context.js';

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

it('reads Oracle boolean flags from VARCHAR2 columns', async () => {
  class Flag extends Model {}
  Flag.init({
    id: { type: DataTypes.INTEGER, primaryKey: true },
    enabled: { type: DataTypes.BOOLEAN, field: 'flag_text' },
    original: { type: DataTypes.STRING(20) },
    numeric: { type: DataTypes.BOOLEAN }
  }, { modelName: 'Flag', tableName: testTable('bool_text'), timestamps: false });
  const context = await createTestContext({ models: [Flag] });
  try {
    const definition = context.seq._buildTableDefinition(Flag);
    await context.adapter.ddl.createTable({
      ...definition,
      columns: { ...definition.columns, enabled: { ...definition.columns.enabled, type: DataTypes.STRING(20) } }
    });
    context.adapter.schemas.delete(definition.tableName);
    await context.seq._registerExistingSchemas();
    const cases = [
      ['1', true], ['S', true], ['Y', true], ['true', true],
      ['s', true], ['y', true], ['TRUE', true], [' true ', true], ['S  ', true],
      ['0', false], ['N', false], ['false', false], ['other', false], [null, false]
    ];
    const columns = ['id', 'enabled', 'original', 'numeric'].map(attr => quoteTestIdentifier(definition.attrToColumn[attr])).join(', ');
    for (const [index, [value, expected]] of cases.entries()) {
      await context.adapter.dml._execute(
        `INSERT INTO ${quoteTestIdentifier(definition.tableName)} (${columns}) VALUES (?, ?, ?, ?)`,
        [index + 1, value, value, expected ? 1 : 0]
      );
    }
    const rows = await Flag.findAll({ order: [['id', 'ASC']], plain: true });
    for (const [index, [value, expected]] of cases.entries()) {
      assert.equal(rows[index].enabled, expected, `Boolean flag ${JSON.stringify(value)}`);
      assert.equal(rows[index].numeric, expected);
      assert.equal(rows[index].original, value);
    }
  } finally {
    await cleanupTestContext(context);
  }
});

runAdapterSuite({
  name,
  createSeq({ models }) {
    const adapter = new Adapter({ ...oracleTestOptions(), naming: { prefix } });
    return { seq: new Seq({ adapter, models, logging: false }), adapter };
  },
  cleanup: cleanupOracle
});
