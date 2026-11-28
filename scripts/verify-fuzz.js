import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  ['interpolation', /SQL text depends on bound strings|unexpected predicate dialect drift|value was interpolated into SQL|bind arity/],
  ['missing-bind', /parameter order or conversion/],
  ['unbalanced-sql', /Unexpected closing parenthesis|Unbalanced parentheses/],
  ['boolean-conversion', /oracle11: parameter order or conversion|oracle11: value serialization/],
  ['nested-operator', /unexpected predicate dialect drift/],
  ['oracle-binds', /Oracle bind numbering/],
  ['insert-column', /sqlite: (?:insert|upsert) SQL structure/],
  ['update-parameters', /sqlite: (?:update|upsert) parameter order or conversion/],
  ['missing-where-guard', /mutation WHERE guard/],
  ['upsert-composite-key', /UPSERT lookup keys|composite UPSERT target/],
  ['join-composite-key', /composite JOIN links\/type/],
  ['join-type', /composite JOIN links\/type/],
  ['join-projection', /JOIN projection/],
  ['required-composite-key', /Required include composite links/],
  ['empty-join-filter', /Incomplete SQL clause/]
];

// A healthy baseline prevents unrelated startup failures from counting as detection.
for (const [mutation, expected] of [['baseline', null], ...cases]) {
  const result = spawnSync(process.execPath, ['scripts/run-fuzz.js', 'verify'], {
    cwd: root,
    env: { ...process.env, SEQ_FUZZ_MUTATION: mutation === 'baseline' ? '' : mutation },
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024
  });
  const output = result.stdout + result.stderr;
  assert.ifError(result.error);
  assert.equal(result.signal, null, output);
  if (expected) {
    assert.notEqual(result.status, 0, 'Undetected mutation: ' + mutation);
    assert.match(output, /AssertionError/, output);
    assert.match(output, expected, output);
    console.log('DETECTED ' + mutation);
  } else {
    assert.equal(result.status, 0, output);
    console.log('PASS healthy baseline');
  }
}
console.log('Detected all ' + cases.length + ' intentional SQL generator defects.');
