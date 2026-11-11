import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MySQLAdapter, Oracle11Adapter } from '../src/index.js';
import { formatDateInTimezone, parseDateInTimezone, validateTimezone } from '../src/utils/timezone.js';

it('validates fixed timezone offsets before opening database connections', () => {
  for (const Adapter of [MySQLAdapter, Oracle11Adapter]) {
    for (const timezone of ['-03:00', '+05:30', '+14:00', '-12:00', 'Z']) assert.doesNotThrow(() => new Adapter({ timezone }));
    for (const timezone of ['EST', 'America/Asuncion', '+14:01', '-12:01', '+03:60', "-03:00'; DROP TABLE x", null]) {
      assert.throws(() => new Adapter({ timezone }), { code: 'SEQ_INVALID_TIMEZONE' });
    }
  }
  assert.doesNotThrow(() => new MySQLAdapter({ timezone: 'local' }));
  assert.equal(validateTimezone(undefined), undefined);
});

it('formats fixed-offset date defaults and parses unzoned values without relying on process TZ', () => {
  const date = new Date('2026-11-10T14:30:00.123-03:00');
  assert.equal(formatDateInTimezone(date, '-03:00'), '2026-11-10 14:30:00.123');
  assert.equal(formatDateInTimezone(date, '-03:00', 0), '2026-11-10 14:30:00');
  assert.equal(formatDateInTimezone(date, '+09:00'), '2026-11-11 02:30:00.123');
  assert.equal(parseDateInTimezone('2026-11-10 14:30:00.123', '-03:00').getTime(), date.getTime());
  assert.equal(parseDateInTimezone('2026-11-10T14:30:00.123-03:00', '+09:00').getTime(), date.getTime());
  assert.equal(parseDateInTimezone('2026-11-10', '-03:00').toISOString(), '2026-11-10T03:00:00.000Z');
  assert.equal(new MySQLAdapter({ timezone: '-03:00' }).dml._serializeValue(date), date);
});
