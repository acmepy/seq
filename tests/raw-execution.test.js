import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataTypes, Model } from '../src/index.js';
import { cleanupTestContext, createTestContext, quoteTestIdentifier, testTable } from './shared/test-context.js';

it('executes public raw SQL methods with ordered parameters, empty results and active transactions', async () => {
  class RawRecord extends Model {}
  RawRecord.init({
    id: { type: DataTypes.INTEGER, primaryKey: true },
    text: { type: DataTypes.STRING(100) }
  }, { modelName: 'PublicRawRecord', tableName: testTable('public_raw'), timestamps: false });
  const events = [];
  const context = await createTestContext({ models: [RawRecord],
    logging: { info: false, trace: (...args) => events.push(args.at(-1)), warn: false, error: false }, slowQueryMs: Number.MAX_VALUE });
  try {
    const { adapter, seq } = context;
    await seq.sync();
    const definition = seq.buildTableDefinition(RawRecord);
    const q = quoteTestIdentifier;
    const table = q(RawRecord.tableName);
    const id = q(definition.attrToColumn.id);
    const text = q(definition.attrToColumn.text);
    const select = 'SELECT ' + id + ' AS ' + q('row_id') + ', ' + text + ' AS ' + q('row_text') + ' FROM ' + table;
    const missing = await adapter.dml.executeGet(select + ' WHERE ' + id + ' = ?', [999]);
    assert.equal(missing, null);
    assert.deepEqual(await adapter.dml.executeQueryAll(select), []);
    const payload = "O'Reilly ?";
    const inserted = await adapter.dml.execute('INSERT INTO ' + table + ' (' + id + ', ' + text + ') VALUES (?, ?)', [1, payload]);
    assert.equal(inserted.changes, 1);
    const row = await adapter.dml.executeGet(select);
    assert.deepEqual(row, { row_id: 1, row_text: payload });
    assert.equal(row instanceof Model, false);
    assert.deepEqual(await adapter.dml.executeQueryAll(select + ' WHERE ' + id + ' = ? AND ' + text + ' = ?', [1, payload]), [row]);
    const changed = await adapter.dml.execute('UPDATE ' + table + ' SET ' + text + ' = ? WHERE ' + id + ' = ?', ['changed', 1]);
    assert.equal(changed.changes, 1);
    assert.equal((await adapter.dml.executeGet(select)).row_text, 'changed');
    const aborted = new Error('rollback raw SQL');
    await assert.rejects(seq.transaction(async () => {
      await adapter.dml.execute('UPDATE ' + table + ' SET ' + text + ' = ? WHERE ' + id + ' = ?', ['temporary', 1]);
      assert.equal((await adapter.dml.executeGet(select)).row_text, 'temporary');
      throw aborted;
    }), error => error === aborted);
    assert.equal((await adapter.dml.executeGet(select)).row_text, 'changed');
    assert.equal((await adapter.dml.execute('DELETE FROM ' + table + ' WHERE ' + id + ' = ?', [1])).changes, 1);
    assert.equal(await adapter.dml.executeGet(select), null);
    assert.ok(events.some(event => event.type === 'sql' && event.params?.length === 2 && event.params[1] === payload && Number.isFinite(event.sqlDurationMs)));
  } finally { await cleanupTestContext(context); }
});
