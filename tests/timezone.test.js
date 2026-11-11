import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes, Model } from '../src/index.js';
import { cleanupTestContext, createTestContext, testAdapterName, testTable } from './shared/test-context.js';
import { formatDateInTimezone } from '../src/utils/timezone.js';

const engine = testAdapterName();
const oracle = engine.startsWith('oracle');
describe('Configured SQL timezone', { skip: !['mysql', 'oracle11', 'oracle12'].includes(engine) }, () => {
  it('preserves -03:00 wall time through native DATE/DATETIME, defaults, filters and repeated saves', async () => {
    const instant = new Date('2026-11-10T14:30:00-03:00');
    class Clock extends Model {}
    Clock.init({
      id: { type: DataTypes.INTEGER, primaryKey: true },
      happenedAt: { type: DataTypes.DATE },
      fixedAt: { type: DataTypes.DATE, defaultValue: instant },
      nullableAt: { type: DataTypes.DATE, allowNull: true }
    }, { modelName: 'TimezoneClock', tableName: testTable('tz_clock'), timestamps: true });
    const context = await createTestContext({ models: [Clock], adapterOptions: { timezone: '-03:00' } });
    const { adapter, seq } = context;
    try {
      await seq.sync();
      const def = seq.buildTableDefinition(Clock);
      const q = name => adapter._quoteIdentifier(name);
      const table = q(def.tableName);
      const column = attr => q(def.attrToColumn[attr]);
      const text = attr => oracle ? 'TO_CHAR(' + column(attr) + ", 'YYYY-MM-DD HH24:MI:SS')" : 'DATE_FORMAT(' + column(attr) + ", '%Y-%m-%d %H:%i:%s')";
      const raw = async id => adapter.dml.executeGet('SELECT ' + text('happenedAt') + ' AS ' + q('local_time') + ' FROM ' + table + ' WHERE ' + column('id') + ' = ?', [id]);
      const created = await Clock.create({ id: 1, happenedAt: instant, nullableAt: null });
      assert.equal((await raw(1)).local_time, '2026-11-10 14:30:00');
      let found = await Clock.findByPk(1);
      assert.equal(found.getDataValue('happenedAt').toISOString(), instant.toISOString());
      assert.equal(found.getDataValue('nullableAt'), null);
      for (let index = 0; index < 3; index++) {
        await found.save();
        found = await Clock.findByPk(1);
        assert.equal((await raw(1)).local_time, '2026-11-10 14:30:00');
        assert.equal(found.getDataValue('happenedAt').getTime(), instant.getTime());
      }
      assert.equal((await Clock.findAll({ where: { happenedAt: instant } })).length, 1);
      const literal = oracle ? "TO_DATE('2026-11-10 14:30:00', 'YYYY-MM-DD HH24:MI:SS')" : "'2026-11-10 14:30:00'";
      await adapter.dml.execute('INSERT INTO ' + table + ' (' + column('id') + ', ' + column('happenedAt') + ') VALUES (2, ' + literal + ')');
      const fromDatabase = await Clock.findByPk(2);
      assert.equal(fromDatabase.getDataValue('happenedAt').toISOString(), instant.toISOString());
      assert.equal(fromDatabase.getDataValue('fixedAt').toISOString(), instant.toISOString());
      const dbNow = await adapter.dml.executeGet('SELECT ' + text('createdAt') + ' AS ' + q('created') + ' FROM ' + table + ' WHERE ' + column('id') + ' = 2');
      assert.equal(dbNow.created, formatDateInTimezone(fromDatabase.getDataValue('createdAt'), '-03:00', 0));
      const serverClock = await adapter.dml.executeGet(oracle
        ? 'SELECT TO_CHAR(SYS_EXTRACT_UTC(SYSTIMESTAMP), ' + "'YYYY-MM-DD HH24:MI:SS') AS \"clock\" FROM DUAL"
        : "SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS clock");
      assert.ok(Math.abs(fromDatabase.getDataValue('createdAt').getTime() - new Date(serverClock.clock.replace(' ', 'T') + 'Z').getTime()) < 15000);
      const changed = new Date('2026-11-11T00:15:00-03:00');
      await Clock.update({ happenedAt: changed }, { where: { id: 1 } });
      assert.equal((await raw(1)).local_time, '2026-11-11 00:15:00');
      const aborted = new Error('rollback');
      await assert.rejects(seq.transaction(async transaction => {
        await Clock.create({ id: 3, happenedAt: instant }, { transaction });
        assert.equal((await Clock.findByPk(3, { transaction })).getDataValue('happenedAt').getTime(), instant.getTime());
        throw aborted;
      }), error => error === aborted);
      assert.equal(await Clock.findByPk(3), null);
      assert.ok(created.getDataValue('createdAt') instanceof Date);
    } finally { await cleanupTestContext(context); }
  });

  it('initializes every new physical pool connection to -03:00', async () => {
    const hookZones = [];
    const context = await createTestContext({ models: [], adapterOptions: {
      timezone: '-03:00', ...(oracle ? {
        poolMin: 0, poolMax: 2, afterConnect: async connection => {
          const result = await connection.execute('SELECT SESSIONTIMEZONE FROM DUAL');
          hookZones.push(result.rows[0][0]);
        }
      } : { connectionLimit: 2 })
    } });
    const { adapter } = context;
    const held = [];
    try {
      for (let index = 0; index < 2; index++) held.push(oracle ? await adapter._pool.getConnection() : await adapter._acquireConnection());
      for (const connection of held) {
        const result = await connection.execute(oracle ? 'SELECT SESSIONTIMEZONE AS "zone" FROM DUAL' : 'SELECT @@session.time_zone AS zone', [], oracle ? { outFormat: adapter._client.OUT_FORMAT_OBJECT } : undefined);
        const row = oracle ? result.rows[0] : result[0][0];
        assert.equal(row.zone, '-03:00');
      }
      const dropped = held.pop();
      if (oracle) await dropped.close({ drop: true }); else dropped.destroy();
      const connection = oracle ? await adapter._pool.getConnection() : await adapter._acquireConnection();
      held.push(connection);
      const result = await connection.execute(oracle ? 'SELECT SESSIONTIMEZONE AS "zone" FROM DUAL' : 'SELECT @@session.time_zone AS zone', [], oracle ? { outFormat: adapter._client.OUT_FORMAT_OBJECT } : undefined);
      assert.equal((oracle ? result.rows[0] : result[0][0]).zone, '-03:00');
      if (oracle) { assert.ok(hookZones.length >= 3); assert.ok(hookZones.every(zone => zone === '-03:00')); }
    } finally {
      for (const connection of held) { if (oracle) await connection.close(); else connection.release(); }
      await cleanupTestContext(context);
    }
  });
});
