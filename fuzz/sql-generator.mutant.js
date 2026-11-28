// Isolated negative controls. Never imported by the normal fuzz target or production.
import { fuzz, profiles } from './sql-generator.fuzz.js';

const sqlite = profiles.find(profile => profile.name === 'sqlite').dml;
const oracle = profiles.find(profile => profile.name === 'oracle11').dml;
function wrap(object, method, change) {
  const original = object[method];
  object[method] = function (...args) { return change(original.apply(this, args), args); };
}

switch (process.env.SEQ_FUZZ_MUTATION) {
  case 'interpolation':
    wrap(sqlite, '_buildWhere', result => ({
      ...result, sql: result.sql.replace('?', () => String(result.params[0]))
    }));
    break;
  case 'missing-bind':
    wrap(sqlite, '_buildWhere', result => ({ ...result, params: result.params.slice(1) }));
    break;
  case 'unbalanced-sql':
    wrap(sqlite, '_applyLimitOffset', sql => sql + ')');
    break;
  case 'boolean-conversion':
    wrap(oracle, '_serializeValue', (result, [value]) => typeof value === 'boolean' ? (value ? 1 : 0) : result);
    break;
  case 'nested-operator':
    wrap(sqlite, '_buildWhere', result => ({ ...result, sql: result.sql.replace(/\bOR\b/g, 'AND') }));
    break;
  case 'oracle-binds':
    oracle._oracleSql = sql => sql.replaceAll('?', ':1');
    break;
  case 'insert-column': {
    const original = sqlite.insert;
    sqlite.insert = function (model, values, options) {
      const record = { ...values };
      delete record.text;
      return original.call(this, model, record, options);
    };
    break;
  }
  case 'update-parameters': {
    const original = sqlite.update;
    sqlite.update = function (...args) {
      const proxy = Object.create(this);
      const execute = this.execute.bind(this);
      proxy.execute = (sql, params) => {
        const swapped = [...params];
        [swapped[0], swapped[2]] = [swapped[2], swapped[0]];
        return execute(sql, swapped);
      };
      return original.apply(proxy, args);
    };
    break;
  }
  case 'missing-where-guard':
    sqlite._requireWhere = function (where, schema, alias) { return this._buildWhere(where || {}, schema, alias); };
    break;
  case 'upsert-composite-key':
    wrap(sqlite, '_resolveUpsertWhere', result => {
      const broken = { ...result };
      delete broken.id;
      return broken;
    });
    break;
  case 'join-composite-key':
    wrap(sqlite, '_buildJoinClause', result => ({
      ...result, sql: result.sql.replace(/ AND "[^"]+"\."(?:ROW_ID|OWNER_ID)" = "[^"]+"\."(?:ROW_ID|OWNER_ID)"/g, '')
    }));
    break;
  case 'join-type':
    wrap(sqlite, '_buildJoinClause', result => ({ ...result, sql: result.sql.replaceAll('LEFT JOIN', 'INNER JOIN') }));
    break;
  case 'join-projection':
    wrap(sqlite, '_buildQualifiedSelect', result => result.split(', ').filter(part => !part.endsWith('.tenant"')).join(', '));
    break;
  case 'required-composite-key':
    wrap(sqlite, '_requiredIncludeConditions', result => ({
      ...result, conditions: result.conditions.map(sql => sql.replace(/ AND "[^"]+"\."(?:ROW_ID|OWNER_ID)" = "[^"]+"\."(?:ROW_ID|OWNER_ID)"/g, ''))
    }));
    break;
  case 'empty-join-filter':
    wrap(sqlite, '_buildJoinClause', (result, [includes]) => ({
      ...result, sql: result.sql + (includes.some(inc => inc.where && Reflect.ownKeys(inc.where).length === 0) ? ' AND ' : '')
    }));
    break;
  default:
    throw new Error('Unknown SQL fuzz mutation');
}

export { fuzz };
