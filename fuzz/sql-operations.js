import assert from 'node:assert/strict';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { Op } from '../src/operators.js';
import { ValidationError, ValidationWhereError } from '../src/core/errors/ValidationError.js';
import { buildIncludeSqlAliasMap, normalizeInclude, resolveIncludeAlias } from '../src/utils/include.js';

export class Master extends Model {}
export class Detail extends Model {}
Master.init({
  tenant: { type: DataTypes.INTEGER, primaryKey: true, field: 'TENANT_ID' },
  id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ROW_ID' },
  text: { type: DataTypes.STRING(300), field: 'PAYLOAD_TEXT', allowNull: true },
  amount: { type: DataTypes.NUMBER, field: 'AMOUNT_VALUE', allowNull: true },
  active: { type: DataTypes.BOOLEAN, field: 'IS_ACTIVE', allowNull: true },
  date: { type: DataTypes.DATE, field: 'CREATED_ON', allowNull: true },
  optional: { type: DataTypes.STRING(300), field: 'OPTIONAL_VALUE', allowNull: true },
  metadata: { type: DataTypes.JSON, field: 'META_JSON', allowNull: true },
  display: { type: DataTypes.VIRTUAL }
}, { modelName: 'FuzzMaster', tableName: 'FUZZ_MASTERS', alias: 'entry', timestamps: false });
Detail.init({
  tenant: { type: DataTypes.INTEGER, primaryKey: true, field: 'OWNER_TENANT' },
  master: { type: DataTypes.INTEGER, primaryKey: true, field: 'OWNER_ID' },
  line: { type: DataTypes.INTEGER, primaryKey: true, field: 'LINE_ID' },
  text: { type: DataTypes.STRING(300), field: 'DETAIL_TEXT', allowNull: true },
  active: { type: DataTypes.BOOLEAN, field: 'DETAIL_ACTIVE', allowNull: true },
  display: { type: DataTypes.VIRTUAL }
}, { modelName: 'FuzzDetail', tableName: 'FUZZ_DETAILS', alias: 'entry', timestamps: false });
Master.hasMany(Detail, { as: 'details', foreignKey: ['tenant', 'master'] });
Master.hasOne(Detail, { as: 'first', foreignKey: ['tenant', 'master'] });
Detail.belongsTo(Master, { as: 'owner', foreignKey: ['tenant', 'master'] });
export const operationModels = [Master, Detail];

function text(data) {
  return '__JAZZER_VALUE__' + data.consumeString(48) + data.pickValue(["' OR 1=1 --", '? :1 /* */', '\0', '日本語']);
}

// Run real DML until its execution boundary. No driver callback or SQL is executed.
async function capture(dml, model, record, operation, options, existing) {
  const proxy = Object.create(dml);
  const stop = new Error('SQL captured');
  let captured;
  const boundary = (sql, params) => { captured = { sql, params }; throw stop; };
  proxy.execute = boundary;
  proxy.executeQueryAll = boundary;
  proxy.executeGet = boundary;
  proxy._measureSql = boundary; // Oracle INSERT has its own execution path.
  // UPDATE requires selected keys before it compiles. Supply only this fixture input;
  // do not simulate a database or make assertions about rows/affected counts.
  proxy.selectAll = async () => [new model(record, { _isNew: false })];
  proxy.selectOne = async (_, query) => {
    assert.deepEqual(query.where, options.where || { tenant: record.tenant, id: record.id }, 'UPSERT lookup keys');
    return existing ? new model(record, { _isNew: false }) : null;
  };
  try {
    if (operation === 'delete') await proxy.delete(model, options);
    else await proxy[operation](model, record, options);
    assert.fail(operation + ': execution boundary was not reached');
  } catch (error) {
    if (error !== stop) throw error;
  }
  assert.ok(captured, operation + ': SQL was not captured');
  return captured;
}

export async function fuzzOperations(data, profiles, inspect, expected) {
  const operation = data.pickValue(['insert', 'update', 'delete', 'upsert']);
  const existing = data.consumeBoolean();
  const target = data.consumeIntegralInRange(0, 2);
  const tenant = data.consumeIntegralInRange(1, 100000);
  const id = data.consumeIntegralInRange(1, 100000);
  const record = {
    tenant, id, text: text(data), amount: data.consumeIntegral(4, true) / 100,
    active: data.consumeBoolean(), date: new Date(data.consumeIntegralInRange(0, 4102444800000)),
    optional: data.consumeBoolean() ? null : text(data), metadata: { label: text(data), items: [null, true] }
  };
  for (const attribute of ['amount', 'active', 'date', 'metadata']) {
    if (data.consumeBoolean()) record[attribute] = null;
  }
  const options = operation === 'upsert'
    ? target === 0 ? {} : target === 1 ? { conflictFields: ['tenant', 'id'] } : { where: { tenant, id } }
    : { where: { tenant, id } };
  for (const profile of profiles) {
    const { dml, adapter, name } = profile;
    const { schema } = dml._schema(Master);
    const actual = await capture(dml, Master, record, operation, options, existing);
    const q = name === 'mysql' ? '`' : '"';
    const quote = column => q + column + q;
    const columns = Object.keys(record).map(attribute => Master.rawAttributes[attribute].field);
    const keySql = quote('TENANT_ID') + ' = ? AND ' + quote('ROW_ID') + ' = ?';
    const kind = operation === 'upsert' ? existing ? 'update' : 'insert' : operation;
    const expectedSql = kind === 'insert'
      ? `INSERT INTO ${quote('FUZZ_MASTERS')} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
      : kind === 'update'
        ? `UPDATE ${quote('FUZZ_MASTERS')} SET ${columns.map(column => quote(column) + ' = ?').join(', ')} WHERE ${keySql}`
        : `DELETE FROM ${quote('FUZZ_MASTERS')} WHERE ${keySql}`;
    const expectedValues = kind === 'insert' ? Object.values(record) : kind === 'update' ? [...Object.values(record), tenant, id] : [tenant, id];
    const normalized = name === 'oracle11' && kind === 'insert' ? actual.sql.replace(/:\d+/g, '?') : actual.sql;
    assert.equal(normalized, expectedSql, name + ': ' + operation + ' SQL structure');
    assert.deepEqual(actual.params, expectedValues.map(value => expected(value, profile)), name + ': ' + operation + ' parameter order or conversion');
    assert.ok(!actual.sql.includes('__JAZZER_VALUE__'), name + ': mutation value interpolated');
    if (name === 'oracle11') {
      const sql = kind === 'insert' ? actual.sql : dml._oracleSql(actual.sql);
      assert.deepEqual(inspect(sql, true), actual.params.map((_, index) => String(index + 1)), 'Mutation Oracle bind numbering');
    } else assert.equal(inspect(actual.sql).length, actual.params.length, 'Mutation bind arity');

    assert.deepEqual(dml._resolveUpsertWhere(Master, record, {}, schema), { tenant, id }, name + ': composite UPSERT target');
    assert.throws(() => dml._resolveUpsertWhere(Master, { tenant }, {}, schema), error => error instanceof ValidationError && error.code === 'SEQ_VALIDATION_UPSERT_TARGET');
    assert.throws(() => dml._resolveUpsertWhere(Master, record, { conflictFields: ['display'] }, schema), ValidationError);
    const invalid = [null, undefined, {}, { [Op.and]: [] }, { [Op.or]: [{ [Op.and]: [] }] }];
    for (const where of invalid) {
      assert.throws(() => dml._requireWhere(where, schema), ValidationWhereError, name + ': mutation WHERE guard');
      await assert.rejects(capture(dml, Master, record, 'update', { where }, false), ValidationWhereError);
      await assert.rejects(capture(dml, Master, record, 'delete', { where }, false), ValidationWhereError);
    }
    assert.ok(adapter._pool == null && adapter._db == null, 'Fuzzing unexpectedly opened a database');
  }
}

export function fuzzIncludes(data, profiles, inspect, expected) {
  const root = data.consumeBoolean() ? Master : Detail;
  const edges = [];
  let parent = root;
  let parentIncludes;
  let includes;
  for (let index = 0, depth = data.consumeIntegralInRange(1, 3); index < depth; index++) {
    const child = parent === Master ? Detail : Master;
    const as = parent === Master ? data.pickValue(['details', 'first']) : 'owner';
    const payload = text(data);
    const filter = data.pickValue(['none', 'empty', 'text', 'active']);
    const active = data.consumeBoolean();
    const inc = {
      model: child, as, eager: true, required: data.consumeBoolean(),
      attributes: data.consumeBoolean() ? ['text', 'display'] : null,
      where: filter === 'none' ? null : filter === 'empty' ? {} : filter === 'text' ? { text: payload } : { active },
      include: []
    };
    edges.push({ parent, child, inc, values: filter === 'text' ? [payload] : filter === 'active' ? [active] : [] });
    if (parentIncludes) parentIncludes.push(inc);
    else includes = [inc];
    parentIncludes = inc.include;
    parent = child;
  }
  // Exercise the same include normalization used by models.
  includes = normalizeInclude(includes);
  let normalized = includes[0];
  for (const edge of edges) { edge.inc = normalized; normalized = normalized.include[0]; }
  for (const profile of profiles) {
    const { dml, name } = profile;
    const { schema } = dml._schema(root);
    const aliases = buildIncludeSqlAliasMap(includes, root, dml, true);
    assert.equal(new Set([root.alias, ...aliases.values()]).size, edges.length + 1, 'Unique include aliases');
    const joins = dml._buildJoinClause(includes, root, root.alias, resolveIncludeAlias, aliases, true);
    assert.deepEqual(joins.params, edges.flatMap(edge => edge.values).map(value => expected(value, profile)), name + ': JOIN parameter order');
    let parentAlias = root.alias;
    for (const edge of edges) {
      const alias = aliases.get(edge.inc);
      const pairs = edge.parent === Master
        ? [['TENANT_ID', 'OWNER_TENANT'], ['ROW_ID', 'OWNER_ID']]
        : [['OWNER_TENANT', 'TENANT_ID'], ['OWNER_ID', 'ROW_ID']];
      const link = pairs.map(([source, target]) => dml._colRef(source, parentAlias) + ' = ' + dml._colRef(target, alias)).join(' AND ');
      const prefix = (edge.inc.required ? 'INNER JOIN ' : 'LEFT JOIN ') + dml._tableWithAlias(edge.child.tableName, alias) + ' ON ';
      assert.ok(joins.sql.includes(prefix + link), name + ': composite JOIN links/type');
      parentAlias = alias;
    }
    assert.equal((joins.sql.match(/\bJOIN\b/g) || []).length, edges.length, 'JOIN count');
    const selected = dml._buildQualifiedSelect(root, schema, root.alias, includes, aliases, true, ['text', 'display']);
    const projections = [];
    for (const { model, alias, attributes } of [
      { model: root, alias: root.alias, attributes: ['text', 'display'] },
      ...edges.map(edge => ({ model: edge.child, alias: aliases.get(edge.inc), attributes: edge.inc.attributes }))
    ]) {
      for (const [attribute, definition] of Object.entries(model.rawAttributes)) {
        if (attribute === 'display' || (attributes && !attributes.includes(attribute) && !definition.primaryKey)) continue;
        projections.push(dml._colRef(definition.field, alias) + ' AS ' + dml._q(alias + '.' + attribute));
      }
    }
    assert.equal(selected, projections.join(', '), name + ': JOIN projection');
    const sql = 'SELECT ' + selected + ' FROM ' + dml._tableWithAlias(root.tableName, root.alias) + joins.sql;
    assert.ok(!sql.includes('__JAZZER_VALUE__'), 'JOIN value interpolated');
    assert.equal(inspect(sql).length, joins.params.length, 'JOIN bind arity');
    const required = dml._requiredIncludeConditions(includes, root, root.alias);
    const requiredEdges = [];
    for (const edge of edges) {
      if (!edge.inc.required) break;
      requiredEdges.push(edge);
    }
    assert.equal((required.conditions.join(' ').match(/\bEXISTS\b/g) || []).length, requiredEdges.length, 'Required include EXISTS count');
    parentAlias = root.alias;
    for (const [index, edge] of requiredEdges.entries()) {
      const alias = 'seq_req_' + (index + 1);
      const pairs = edge.parent === Master
        ? [['TENANT_ID', 'OWNER_TENANT'], ['ROW_ID', 'OWNER_ID']]
        : [['OWNER_TENANT', 'TENANT_ID'], ['OWNER_ID', 'ROW_ID']];
      const link = pairs.map(([source, target]) => dml._colRef(source, parentAlias) + ' = ' + dml._colRef(target, alias)).join(' AND ');
      assert.ok(required.conditions.join(' ').includes('WHERE ' + link), 'Required include composite links');
      parentAlias = alias;
    }
    assert.deepEqual(required.params, requiredEdges.flatMap(edge => edge.values).map(value => expected(value, profile)), 'Required include parameter order');
    if (required.conditions.length) assert.equal(inspect('SELECT 1 WHERE ' + required.conditions.join(' AND ')).length, required.params.length, 'Required include bind arity');
  }
}
