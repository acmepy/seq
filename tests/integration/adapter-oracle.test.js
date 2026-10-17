import 'dotenv/config';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataTypes, Model, Op, Seq, Oracle11Adapter, Oracle12Adapter } from '../../src/index.js';
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
      ['0', false], ['N', false], ['false', false], ['other', false], [null, null]
    ];
    const columns = ['id', 'enabled', 'original', 'numeric'].map(attr => quoteTestIdentifier(definition.attrToColumn[attr])).join(', ');
    for (const [index, [value, expected]] of cases.entries()) {
      await context.adapter.dml._execute(
        `INSERT INTO ${quoteTestIdentifier(definition.tableName)} (${columns}) VALUES (?, ?, ?, ?)`,
        [index + 1, value, value, expected === null ? null : expected ? 1 : 0]
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

it('uses configured Oracle boolean values for schema, writes, reads and filters', async () => {
  class Flags extends Model {}
  Flags.init({
    id: { type: DataTypes.INTEGER, primaryKey: true },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    override: { type: DataTypes.BOOLEAN, field: 'custom_flag', booleanValues: { true: 'Y', false: 'N' }, defaultValue: false },
    reversed: { type: DataTypes.BOOLEAN, booleanValues: { true: 'N', false: 'Y' } },
    numeric: { type: DataTypes.BOOLEAN, booleanValues: { true: 1, false: 0 } }
  }, { modelName: 'Flags', tableName: testTable('bool_config'), timestamps: false });
  const context = await createTestContext({ models: [Flags], adapterOptions: { booleanValues: { true: 'S', false: 'N' } } });
  try {
    await context.seq.sync();
    const definition = context.seq._buildTableDefinition(Flags);
    const q = quoteTestIdentifier;
    const table = q(definition.tableName);
    const id = q(definition.attrToColumn.id);
    await Flags.create({ id: 1, reversed: true, numeric: false });
    await Flags.bulkCreate([{ id: 2, enabled: false, override: true, reversed: false, numeric: true },
      { id: 3, enabled: null, override: null, reversed: null, numeric: null }]);
    const raw = await context.adapter.dml._executeGet(`SELECT * FROM ${table} WHERE ${id} = ?`, [1]);
    assert.equal(raw[definition.attrToColumn.enabled], 'S');
    assert.equal(raw[definition.attrToColumn.override], 'N');
    assert.equal(raw[definition.attrToColumn.reversed], 'N');
    assert.equal(raw[definition.attrToColumn.numeric], 0);
    assert.equal((await Flags.findByPk(1)).getDataValue('reversed'), true);
    assert.equal((await Flags.findByPk(2)).getDataValue('reversed'), false);
    const nulls = await Flags.findByPk(3);
    for (const attr of ['enabled', 'override', 'reversed', 'numeric']) assert.equal(nulls.getDataValue(attr), null);
    assert.equal(await Flags.count({ where: { enabled: true } }), 1);
    assert.equal(await Flags.count({ where: { override: { [Op.in]: [true] } } }), 1);
    assert.equal(await Flags.count({ where: { override: { [Op.notIn]: [false] } } }), 1);
    assert.equal(await Flags.count({ where: { [Op.and]: [{ override: { [Op.ne]: false } }, { enabled: false }] } }), 1);
    assert.equal(await Flags.count({ where: { enabled: null } }), 1);
    const associations = Flags.associations;
    Flags.associations = {};
    Flags.hasMany(Flags, { foreignKey: 'id', as: 'matching' });
    try {
      for (const eager of [false, true]) {
        const row = await Flags.findOne({ where: { id: 2 }, include: [{ model: Flags, as: 'matching', where: { override: true }, eager }] });
        assert.equal(row.getDataValue('matching')[0].getDataValue('override'), true);
      }
    } finally {
      Flags.associations = associations;
    }
    await Flags.update({ enabled: false, override: true }, { where: { enabled: true } });
    const updated = await context.adapter.dml._executeGet(`SELECT * FROM ${table} WHERE ${id} = ?`, [1]);
    assert.equal(updated[definition.attrToColumn.enabled], 'N');
    assert.equal(updated[definition.attrToColumn.override], 'Y');
    const [upserted, created] = await Flags.upsert({ id: 1, enabled: true }, { where: { id: 1 } });
    assert.equal(created, false);
    assert.equal(upserted.getDataValue('enabled'), true);
    const instance = await Flags.findByPk(1);
    await instance.update({ enabled: false });
    assert.equal((await Flags.findByPk(1)).getDataValue('enabled'), false);
    await Flags.update({ enabled: null }, { where: { id: 1 } });
    assert.equal((await Flags.findByPk(1)).getDataValue('enabled'), null);
    await context.adapter.dml._execute(`INSERT INTO ${table} (${id}) VALUES (?)`, [4]);
    assert.equal((await Flags.findByPk(4)).getDataValue('enabled'), true);
    assert.equal((await Flags.findByPk(4)).getDataValue('override'), false);
    Flags.rawAttributes.added = { type: DataTypes.BOOLEAN, booleanValues: { true: 'ON', false: 'OFF' }, defaultValue: true };
    await context.seq.sync({ alter: true });
    const addedColumn = q(context.seq._buildTableDefinition(Flags).attrToColumn.added);
    const added = await context.adapter.dml._executeGet(`SELECT ${addedColumn} FROM ${table} WHERE ${id} = ?`, [1]);
    assert.equal(added[context.seq._buildTableDefinition(Flags).attrToColumn.added], 'ON');
    await Flags.destroy({ where: { override: true } });
    assert.equal(await Flags.count({ where: { override: true } }), 0);
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
