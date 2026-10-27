import 'dotenv/config';
import { Seq, MySQLAdapter, Model, DataTypes } from '../../src/index.js';
import { runAdapterSuite } from '../shared/adapter-suite.js';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createTestContext, mysqlTestOptions } from '../shared/test-context.js';

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


it('stores JSON values with the available MySQL column type on create and alter', async () => {
  class JsonValues extends Model {}
  JsonValues.init({
    id: { type: DataTypes.INTEGER, primaryKey: true },
    payload: { type: DataTypes.JSON }, object: { type: DataTypes.OBJECT },
    items: { type: DataTypes.ARRAY(DataTypes.INTEGER) }
  }, { modelName: 'MySQLJsonValues', tableName: 'seq_json_type_check', timestamps: false });
  const context = await createTestContext({ models: [JsonValues] });
  try {
    await context.seq.sync();
    const { adapter, seq } = context;
    const def = seq._buildTableDefinition(JsonValues);
    const payload = { text: 'x'.repeat(70000), nested: { active: true } };
    await JsonValues.create({ id: 1, payload, object: { role: 'admin' }, items: [1, 2] });
    const found = await JsonValues.findByPk(1);
    assert.deepEqual(found.getDataValue('payload'), payload);
    assert.deepEqual(found.getDataValue('object'), { role: 'admin' });
    assert.deepEqual(found.getDataValue('items'), [1, 2]);
    await adapter.ddl.addColumns(def.tableName, { extra: { type: DataTypes.JSON, allowNull: true } });
    const rows = await adapter.dml._executeQueryAll('SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [def.tableName]);
    const types = new Map(rows.map(row => [row.COLUMN_NAME, row.DATA_TYPE]));
    const storage = adapter._supportsJson ? ['json', 'longtext'] : ['longtext'];
    for (const field of [def.attrToColumn.payload, def.attrToColumn.object, def.attrToColumn.items, 'extra']) {
      assert.ok(storage.includes(types.get(field)), field + ' should store JSON');
    }
  } finally {
    try { await context.adapter.ddl.dropTable(JsonValues._resolvedTableName, { ifExists: true }); }
    finally { await context.adapter.close(); }
  }
});
