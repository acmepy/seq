import assert from 'node:assert/strict';
import test from 'node:test';
import { Oracle11Adapter, Oracle12Adapter, Oracle11Error } from '../src/index.js';
import { truncateMiddle } from '../src/utils/naming.js';

test('Oracle sequence names respect case and middle truncation', () => {
  for (const Adapter of [Oracle11Adapter, Oracle12Adapter]) {
    assert.equal(new Adapter().sequenceName('REP_FACTURAS_DET'), 'SEQ_REP_FACTURAS_DET');
    assert.equal(new Adapter({ naming: { caseStyle: 'lower', maxLength: 20 } }).sequenceName('LONG_TABLE_WITH_MANY_COLUMNS'), truncateMiddle('seq_long_table_with_many_columns', 20));
  }
});

test('Oracle SQL diagnostics appear once even when the stack was not read', () => {
  for (const errorNum of [955, 1]) {
    const native = Object.assign(new Error('Oracle failure'), { errorNum });
    const error = Oracle11Error.from(native, 'CREATE SEQUENCE "SEQ_TEST"');
    const again = Oracle11Error.from(error, error.sql);
    assert.equal(again.message.split('SQL: ').length - 1, 1);
    assert.equal(again.stack.split('SQL: ').length - 1, 1);
  }
});
