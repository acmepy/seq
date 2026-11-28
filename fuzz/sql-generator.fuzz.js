import assert from 'node:assert/strict';
import { operationModels, fuzzOperations, fuzzIncludes } from './sql-operations.js';
import { FuzzedDataProvider } from '@jazzer.js/core';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { MySQLAdapter } from '../src/adapters/mysql/MySQLAdapter.js';
import { Oracle11Adapter } from '../src/adapters/oracle11/Oracle11Adapter.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { Op } from '../src/operators.js';
import { ValidationError } from '../src/core/errors/ValidationError.js';

const marker = '__JAZZER_VALUE__';
const attacks = ["' OR 1=1 --", "'; DROP TABLE users; --", '? :1 /* */', '\0', '"`\\', '日本語'];
const fields = ['id', 'text', 'amount', 'active', 'date', 'optional', 'metadata'];
class FuzzRow extends Model {}
FuzzRow.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ROW_ID' },
  text: { type: DataTypes.STRING(300), field: 'PAYLOAD_TEXT' },
  amount: { type: DataTypes.NUMBER, field: 'AMOUNT_VALUE' },
  active: { type: DataTypes.BOOLEAN, field: 'IS_ACTIVE' },
  date: { type: DataTypes.DATE, field: 'CREATED_ON' },
  optional: { type: DataTypes.STRING(300), field: 'OPTIONAL_VALUE' },
  metadata: { type: DataTypes.JSON, field: 'META_JSON' },
  display: { type: DataTypes.VIRTUAL }
}, { modelName: 'FuzzRow', tableName: 'FUZZ_ROWS', timestamps: false });

// Constructors and schema builders only. No driver is loaded and no SQL is executed.
export const profiles = [
  ['sqlite', new SQLiteAdapter({ database: ':memory:' })],
  ['mysql', new MySQLAdapter({ timezone: 'Z' })],
  ['oracle11', new Oracle11Adapter({ booleanValues: { true: 'S', false: 'N' } })]
].map(([name, adapter]) => {
  adapter.connect = () => { throw new Error('Fuzz targets must never connect to a database'); };
  const models = [FuzzRow, ...operationModels];
  for (const model of models) adapter.schemas.set(model.tableName, adapter.buildTableDefinition(model, { models }));
  const schema = adapter.schemas.get(FuzzRow.tableName);
  return { name, adapter, dml: adapter.dml, schema };
});

function value(data, field) {
  if (data.consumeIntegralInRange(0, 7) === 1) return null;
  if (field === 'active') return data.consumeBoolean();
  if (field === 'id' || field === 'amount') {
    return data.pickValue([data.consumeIntegral(4, true), -0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1.25, 1e-12]);
  }
  if (field === 'date') return new Date(data.consumeIntegralInRange(-2208988800000, 4102444800000));
  const text = marker + data.consumeString(64) + data.pickValue(attacks);
  if (field === 'metadata') return { text, items: [data.consumeBoolean(), null, data.consumeIntegral(2)] };
  return data.consumeBoolean() ? text : undefined;
}

function tree(data, depth = 0, budget = { remaining: 24 }) {
  budget.remaining--;
  if (depth < 4 && budget.remaining > 4 && data.consumeBoolean()) {
    const kind = data.consumeBoolean() ? 'and' : 'or';
    const children = [];
    for (let count = data.consumeIntegralInRange(0, 3); count > 0 && budget.remaining > 0; count--) children.push(tree(data, depth + 1, budget));
    return { kind, children };
  }
  const field = data.pickValue(fields);
  const operator = data.pickValue(field === 'metadata' ? ['eq', 'ne'] : ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'notBetween', ...(field === 'text' ? ['like', 'notLike'] : [])]);
  let values = [value(data, field)];
  if (operator === 'in' || operator === 'notIn') values = Array.from({ length: data.consumeIntegralInRange(0, 5) }, () => value(data, field));
  if (operator === 'between' || operator === 'notBetween') values = [value(data, field), value(data, field)];
  return { kind: 'leaf', field, operator, values };
}

function where(node, mutate = false) {
  if (node.kind !== 'leaf') return { [Op[node.kind]]: node.children.map(child => where(child, mutate)) };
  const replace = item => mutate && typeof item === 'string' ? item + "' UNION SELECT 1; --" : item;
  const values = node.values.map(replace);
  const multiple = ['in', 'notIn', 'between', 'notBetween'].includes(node.operator);
  return { [node.field]: { [Op[node.operator]]: multiple ? values : values[0] } };
}

function bindings(node) {
  if (node.kind !== 'leaf') return node.children.flatMap(bindings);
  if (['eq', 'ne'].includes(node.operator) && node.values[0] === null) return [];
  return node.values;
}

function expected(value, profile) {
  if (value instanceof Date) return profile.name === 'sqlite' ? value.toISOString() : value;
  if (value === undefined) return null;
  if (typeof value === 'boolean') return profile.name === 'oracle11' ? value ? 'S' : 'N' : value ? 1 : 0;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value;
}

// Lexical invariants, not a replacement for a vendor SQL parser/server.
function inspect(sql, oracle = false) {
  const tokens = [];
  let parentheses = 0;
  let unquoted = '';
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (char !== '"' && char !== '`' && char !== "'") unquoted += char;
    if (char === '"' || char === '`' || char === "'") {
      const quote = char;
      let closed = false;
      for (index++; index < sql.length; index++) {
        if (sql[index] !== quote) continue;
        if (sql[index + 1] === quote) { index++; continue; }
        closed = true;
        break;
      }
      assert.ok(closed, 'Unterminated SQL quote');
    } else if (char === '(') parentheses++;
    else if (char === ')') { parentheses--; assert.ok(parentheses >= 0, 'Unexpected closing parenthesis'); }
    else if (char === '?') tokens.push('?');
    else if (oracle && char === ':' && /\d/.test(sql[index + 1] || '')) {
      const match = sql.slice(index).match(/^:(\d+)/);
      tokens.push(match[1]);
      index += match[0].length - 1;
    } else assert.ok(char !== ';' && sql.slice(index, index + 2) !== '--' && sql.slice(index, index + 2) !== '/*', 'SQL statement/comment escaped a value');
  }
  assert.equal(parentheses, 0, 'Unbalanced parentheses');
  assert.doesNotMatch(unquoted, /\bIN\s*\(\s*\)|\b(?:WHERE|AND|OR|ON)\s*$|\b(?:AND|OR)\s*\)|\(\s*\)|\b(?:WHERE|AND|OR)\s+(?:AND|OR)\b|\(\s*(?:AND|OR)\b|\b(?:AND|OR)\s+(?:LEFT|INNER)\s+JOIN\b/i, 'Incomplete SQL clause');
  return tokens;
}

function fuzzWhere(data) {
  const node = tree(data);
  const input = where(node);
  const order = [[data.pickValue(fields.filter(field => field !== 'metadata')), data.pickValue(['ASC', 'DESC', 'asc', 'desc'])]];
  const attributes = data.consumeBoolean() ? undefined : [data.pickValue(fields), 'display'];
  const options = {};
  if (data.consumeBoolean()) options.limit = data.consumeIntegralInRange(1, 100);
  if (data.consumeBoolean()) options.offset = data.consumeIntegralInRange(0, 100);
  let commonShape;
  for (const profile of profiles) {
    const { dml, schema, adapter, name } = profile;
    const result = dml._buildWhere(input, schema, 'f');
    assert.deepEqual(result.params, bindings(node).map(item => expected(item, profile)), name + ': parameter order or conversion');
    assert.equal(dml._buildWhere(where(node, true), schema, 'f').sql, result.sql, name + ': SQL text depends on bound strings');
    const shape = result.sql.replaceAll('`', '"');
    if (commonShape === undefined) commonShape = shape;
    else assert.equal(shape, commonShape, name + ': unexpected predicate dialect drift');
    const select = dml._buildSelectList(attributes, schema, 'f');
    assert.ok(select && !select.includes('*') && !select.includes('display'));
    const sql = dml._applyLimitOffset('SELECT ' + select + ' FROM ' + dml._tableWithAlias('FUZZ_ROWS', 'f') + result.sql + dml._buildOrderBy(order, schema, 'f'), options);
    assert.ok(!sql.includes(marker), name + ': value was interpolated into SQL');
    assert.equal(inspect(sql).length, result.params.length, name + ': bind arity');
    if (name === 'mysql') assert.doesNotMatch(sql, /LIMIT\s+-/i, 'MySQL does not accept negative LIMIT');
    if (name === 'oracle11') {
      const converted = dml._oracleSql(sql);
      assert.deepEqual(inspect(converted, true), result.params.map((_, index) => String(index + 1)), 'Oracle bind numbering');
    }
    assert.ok(adapter._pool == null && adapter._db == null, 'Fuzzing unexpectedly opened a database');
  }
}

function fuzzInvalid(data) {
  const kind = data.consumeIntegralInRange(0, 6);
  const payload = marker + data.consumeRemainingAsString();
  for (const { dml, schema } of profiles) {
    const operations = [
      () => dml._buildWhere({ [payload]: 1 }, schema),
      () => dml._buildWhere({ id: { [Op.in]: payload } }, schema),
      () => dml._buildWhere({ id: { [Op.between]: [1] } }, schema),
      () => dml._buildWhere({ [Op.and]: payload }, schema),
      () => dml._buildWhere({ id: { [Op.eq]: 1, [Op.ne]: 2 } }, schema),
      () => dml._buildOrderBy([['id', payload]], schema),
      () => dml._applyLimitOffset('SELECT 1', { limit: -1 })
    ];
    assert.throws(operations[kind], error => error instanceof ValidationError && error.code.startsWith('SEQ_VALIDATION_'));
  }
}

function fuzzTypes(data) {
  const text = data.consumeString(96);
  const number = data.consumeNumber();
  assert.equal(DataTypes.DATE.validate(new Date(NaN)).valid, false);
  assert.equal(DataTypes.INTEGER.validate(NaN).valid, false);
  for (const profile of profiles) {
    for (const value of [number, undefined, null, true, false, new Date(0), { text }, [text, null]]) {
      const column = profile.schema.columns.active;
      assert.deepEqual(profile.dml._serializeValue(value, column), expected(value, profile), profile.name + ': value serialization');
    }
    for (const type of ['IntegerType', 'NumberType', 'DecimalType']) {
      const parsed = profile.dml._parseNumericValue(text, type);
      if (typeof parsed === 'number') {
        assert.ok(Number.isFinite(parsed));
        if (type === 'IntegerType') assert.ok(Number.isSafeInteger(parsed));
      } else assert.equal(parsed, text);
    }
    if (!text || text.includes('\0')) assert.throws(() => profile.adapter._quoteIdentifier(text), TypeError);
    else {
      const quoted = profile.adapter._quoteIdentifier(text);
      const quote = quoted[0];
      assert.equal(quote, profile.name === 'mysql' ? '`' : '"');
      assert.equal(quoted.at(-1), quote);
      assert.equal(quoted.slice(1, -1).replaceAll(quote + quote, quote), text);
      inspect('SELECT ' + quoted + ' FROM ' + profile.adapter._quoteIdentifier('FUZZ_ROWS'));
    }
  }
}

export async function fuzz(input) {
  const data = new FuzzedDataProvider(input.subarray(1));
  const mode = (input[0] || 0) % 5;
  if (mode === 0) fuzzWhere(data);
  else if (mode === 1) fuzzInvalid(data);
  else if (mode === 2) fuzzTypes(data);
  else if (mode === 3) await fuzzOperations(data, profiles, inspect, expected);
  else fuzzIncludes(data, profiles, inspect, expected);
}
