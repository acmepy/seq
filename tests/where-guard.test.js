import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, MapAdapter, Model, Op, Seq } from '../src/index.js';
import { cleanupTestContext, createTestContext, testAdapterName, testTable } from './shared/test-context.js';

const open = [];
afterEach(async () => {
  while (open.length) await cleanupTestContext(open.pop());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupSql() {
  class Guard extends Model {}
  Guard.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING }
  }, { modelName: 'Guard', tableName: testTable('where_guard'), timestamps: false });
  const ctx = await createTestContext({ models: [Guard], logging: false });
  await ctx.seq.sync();
  open.push(ctx);
  return { Guard, dml: ctx.adapter.dml };
}

async function setupMap() {
  class Guard extends Model {}
  Guard.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING }
  }, { modelName: 'Guard', tableName: `where_guard_map_${open.length}`, timestamps: false });
  const adapter = new MapAdapter();
  const seq = new Seq({ adapter, models: [Guard], logging: false });
  await seq.init();
  await seq.sync();
  open.push({ seq, adapter, models: [Guard] });
  return { Guard, dml: adapter.dml };
}

// SEQ_VALIDATION_WHERE must be thrown for every non-effective WHERE permutation
const nonEffective = [
  ['no options',         (M, v) => M.update(v, undefined)],
  ['empty options',      (M, v) => M.update(v, {})],
  ['undefined where',   (M, v) => M.update(v, { where: undefined })],
  ['null where',        (M, v) => M.update(v, { where: null })],
  ['empty object where',(M, v) => M.update(v, { where: {} })],
  ['Op.and empty',      (M, v) => M.update(v, { where: { [Op.and]: [] } })],
  ['Op.or empty',       (M, v) => M.update(v, { where: { [Op.or]: [] } })],
];

const nonEffectiveDestroy = [
  ['no options',         M => M.destroy()],
  ['empty options',      M => M.destroy({})],
  ['undefined where',   M => M.destroy({ where: undefined })],
  ['null where',        M => M.destroy({ where: null })],
  ['empty object where',M => M.destroy({ where: {} })],
  ['Op.and empty',      M => M.destroy({ where: { [Op.and]: [] } })],
  ['Op.or empty',       M => M.destroy({ where: { [Op.or]: [] } })],
];

function isWhereError(err) {
  assert.equal(err.code, 'SEQ_VALIDATION_WHERE', `Expected SEQ_VALIDATION_WHERE, got ${err.code}: ${err.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// SQL adapter (SQLite / MySQL / Oracle via createTestContext)
// ---------------------------------------------------------------------------

describe('WHERE guard — SQL adapter (Model layer)', () => {
  it('Model.update rejects every non-effective WHERE form', async () => {
    const { Guard } = await setupSql();
    for (const [label, call] of nonEffective) {
      await assert.rejects(() => call(Guard, { name: 'x' }), isWhereError, label);
    }
  });

  it('Model.destroy rejects every non-effective WHERE form', async () => {
    const { Guard } = await setupSql();
    for (const [label, call] of nonEffectiveDestroy) {
      await assert.rejects(() => call(Guard), isWhereError, label);
    }
  });

  it('Model.update accepts an effective WHERE', async () => {
    const { Guard } = await setupSql();
    await Guard.create({ name: 'original' });
    // A real predicate must NOT throw
    const rows = await Guard.update({ name: 'updated' }, { where: { id: 1 } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].getDataValue('name'), 'updated');
  });

  it('Model.update accepts a non-empty Op.and WHERE', async () => {
    const { Guard } = await setupSql();
    await Guard.create({ name: 'original' });
    const rows = await Guard.update({ name: 'updated' }, { where: { [Op.and]: [{ id: 1 }] } });
    assert.equal(rows.length, 1);
  });

  it('Model.destroy accepts an effective WHERE', async () => {
    const { Guard } = await setupSql();
    await Guard.create({ name: 'to-delete' });
    const count = await Guard.destroy({ where: { id: 1 } });
    assert.equal(count, 1);
  });
});

// ---------------------------------------------------------------------------
// SQL adapter (DML layer — direct calls, bypass Model)
// ---------------------------------------------------------------------------

describe('WHERE guard — SQL adapter (DML layer)', () => {
  it('dml.update rejects non-effective WHERE', async () => {
    const { Guard, dml } = await setupSql();
    for (const [label, call] of [
      ['no options',          () => dml.update(Guard, { name: 'x' })],
      ['undefined where',    () => dml.update(Guard, { name: 'x' }, { where: undefined })],
      ['null where',         () => dml.update(Guard, { name: 'x' }, { where: null })],
      ['empty object where', () => dml.update(Guard, { name: 'x' }, { where: {} })],
    ]) {
      await assert.rejects(call, isWhereError, label);
    }
  });

  it('dml.delete rejects non-effective WHERE', async () => {
    const { Guard, dml } = await setupSql();
    for (const [label, call] of [
      ['no options',          () => dml.delete(Guard)],
      ['undefined where',    () => dml.delete(Guard, { where: undefined })],
      ['null where',         () => dml.delete(Guard, { where: null })],
      ['empty object where', () => dml.delete(Guard, { where: {} })],
    ]) {
      await assert.rejects(call, isWhereError, label);
    }
  });
});

// ---------------------------------------------------------------------------
// MapAdapter (only when running SQLite to avoid skipping in integration suites)
// ---------------------------------------------------------------------------

describe('WHERE guard — MapAdapter', () => {
  it('Model.update rejects non-effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard } = await setupMap();
    for (const [label, call] of nonEffective) {
      await assert.rejects(() => call(Guard, { name: 'x' }), isWhereError, label);
    }
  });

  it('Model.destroy rejects non-effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard } = await setupMap();
    for (const [label, call] of nonEffectiveDestroy) {
      await assert.rejects(() => call(Guard), isWhereError, label);
    }
  });

  it('MapAdapter dml.update rejects non-effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard, dml } = await setupMap();
    for (const [label, call] of [
      ['no options',          () => dml.update(Guard, { name: 'x' })],
      ['null where',         () => dml.update(Guard, { name: 'x' }, { where: null })],
      ['empty object where', () => dml.update(Guard, { name: 'x' }, { where: {} })],
    ]) {
      await assert.rejects(call, isWhereError, label);
    }
  });

  it('MapAdapter dml.delete rejects non-effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard, dml } = await setupMap();
    for (const [label, call] of [
      ['no options',          () => dml.delete(Guard)],
      ['null where',         () => dml.delete(Guard, { where: null })],
      ['empty object where', () => dml.delete(Guard, { where: {} })],
    ]) {
      await assert.rejects(call, isWhereError, label);
    }
  });

  it('MapAdapter Model.update accepts effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard } = await setupMap();
    await Guard.create({ name: 'original' });
    const rows = await Guard.update({ name: 'updated' }, { where: { id: 1 } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].getDataValue('name'), 'updated');
  });

  it('MapAdapter Model.destroy accepts effective WHERE', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard } = await setupMap();
    await Guard.create({ name: 'to-delete' });
    const count = await Guard.destroy({ where: { id: 1 } });
    assert.equal(count, 1);
  });

  it('MapAdapter count without WHERE is allowed', async () => {
    if (testAdapterName() !== 'sqlite') return;
    const { Guard } = await setupMap();
    await Guard.bulkCreate([{ name: 'a' }, { name: 'b' }]);
    assert.equal(await Guard.count(), 2);
  });
});
