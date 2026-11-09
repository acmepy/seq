import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Seq, Model, DataTypes, MapAdapter } from '../src/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

function capture() {
  const calls = [];
  const logging = Object.fromEntries(['info', 'trace', 'warn', 'error'].map(level => [level, (...args) => calls.push({ level, args, event: args.at(-1) })]));
  return { calls, logging };
}

describe('Logging levels', () => {
  it('validates context providers and keeps disabled logging silent', () => {
    assert.throws(() => new Seq({ adapter: new MapAdapter(), getContext: {} }), { code: 'SEQ_INVALID_GET_CONTEXT' });
    for (const logging of [false, null, () => { throw new Error('unsupported'); }]) {
      const seq = new Seq({ adapter: new MapAdapter(), logging, getContext() { throw new Error('disabled'); } });
      assert.doesNotThrow(() => seq._log('error', 'hidden'));
    }
  });

  it('keeps txId outside JSON and reads concurrent request contexts without leaking other fields', async () => {
    const storage = new AsyncLocalStorage();
    const { calls, logging } = capture();
    const seq = new Seq({ adapter: new MapAdapter(), logging, getContext: () => storage.getStore() });
    seq._log('info', 'outside');
    await Promise.all(['tx-a', 'tx-b'].map(txId => storage.run({ txId, secret: 'private' }, async () => {
      for (const level of ['info', 'trace', 'warn', 'error']) {
        await new Promise(resolve => setImmediate(resolve));
        seq._log(level, { type: 'test', request: txId });
      }
    })));
    assert.deepEqual(calls[0].args, ['[SEQ]', { message: 'outside' }]);
    for (const { args, event } of calls.slice(1)) {
      assert.deepEqual(args, ['[SEQ]', event.request, { type: 'test', request: event.request }]);
      assert.ok(!JSON.stringify(event).includes('private'));
    }
    storage.run({}, () => seq._log('info', 'no-id'));
    assert.deepEqual(calls.at(-1).args, ['[SEQ]', { message: 'no-id' }]);
  });

  it('preserves logger context and disables individual levels', () => {
    const logger = { calls: [], info: false, trace(...args) { this.calls.push(args); }, warn: false, error: false };
    const seq = new Seq({ adapter: new MapAdapter(), logging: logger });
    seq._log('info', 'hidden');
    seq._log('trace', { type: 'sql', sql: 'SELECT 1', params: [] });
    assert.deepEqual(logger.calls, [['[SEQ]', { type: 'sql', sql: 'SELECT 1', params: [] }]]);
  });

  it('serializes a single JSON payload for default and explicit console handlers', () => {
    const originals = { log: console.log, error: console.error, debug: console.debug };
    const calls = [];
    for (const name of Object.keys(originals)) console[name] = function (...args) { calls.push({ name, target: this, args }); };
    try {
      const seq = new Seq({ adapter: new MapAdapter(), getContext: () => ({ txId: 'request' }) });
      seq._log('info', 'ready');
      seq._log('error', { type: 'error', message: 'failed' });
      new Seq({ adapter: new MapAdapter(), logging: { trace: console.debug } })._log('trace', { sql: 'SELECT 1' });
      assert.deepEqual(calls.map(call => call.args), [
        ['[SEQ]', 'request', '{"message":"ready"}'],
        ['[SEQ]', 'request', '{"type":"error","message":"failed"}'],
        ['[SEQ]', '{"sql":"SELECT 1"}']
      ]);
      assert.ok(calls.every(call => call.target === console));
    } finally { Object.assign(console, originals); }
  });

  it('preserves errors, bigints, arrays and repeated values without mutating data or leaking secrets', () => {
    const { calls, logging } = capture();
    const seq = new Seq({ adapter: new MapAdapter(), logging });
    const error = Object.assign(new Error('failed'), { token: 'private', code: 'TEST', errors: { id: 'required' } });
    const shared = { value: 1 };
    const data = { error, again: error, values: [2n, shared, shared], nested: { password: 'private' } };
    data.self = data;
    seq._log('error', data);
    const event = calls[0].event;
    assert.equal(event.error.stack, error.stack);
    assert.equal(event.again.stack, error.stack);
    assert.equal(event.error.code, 'TEST');
    assert.deepEqual(event.error.errors, { id: 'required' });
    assert.equal(event.error.token, '[REDACTED]');
    assert.equal(event.nested.password, '[REDACTED]');
    assert.deepEqual(event.values, ['2', { value: 1 }, { value: 1 }]);
    assert.equal(event.self, '[Circular]');
    assert.equal(data.nested.password, 'private');
    assert.doesNotThrow(() => JSON.stringify(event));
    seq._log('error', error);
    assert.equal(calls.at(-1).event.error.stack, error.stack);
    seq._log('info', 'message', { count: 1 }, ['a']);
    assert.deepEqual(calls.at(-1).event, { message: 'message', data: [{ count: 1 }, ['a']] });
  });

  it('logs sync errors with stack, validation details and operation data before rethrowing', async () => {
    const { calls, logging } = capture();
    const adapter = new MapAdapter();
    const failure = Object.assign(new Error('sync failed'), { code: 'TEST', errors: { id: 'required' }, details: { field: 'id' } });
    adapter.ddl.listTables = async () => { throw failure; };
    const seq = new Seq({ adapter, logging });
    await assert.rejects(seq.sync(), error => error === failure);
    const event = calls.at(-1).event;
    assert.equal(event.type, 'sync');
    assert.equal(event.operation, 'sync');
    assert.equal(event.error.stack, failure.stack);
    assert.deepEqual(event.error.errors, failure.errors);
    assert.deepEqual(event.error.details, failure.details);
  });

  it('logs SQL, model durations, validation errors and concurrent txIds through the active adapter', async () => {
    const storage = new AsyncLocalStorage();
    const { calls, logging } = capture();
    class LoggedUser extends Model {}
    LoggedUser.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, name: { type: DataTypes.STRING(80), unique: true } },
      { modelName: 'LoggedUser', tableName: testTable('logged_users'), timestamps: false });
    const context = await createTestContext({ models: [LoggedUser], logging, getContext: () => storage.getStore(), slowQueryMs: Number.MAX_VALUE, slowOperationMs: Number.MAX_VALUE });
    try {
      await context.seq.sync();
      calls.length = 0;
      await LoggedUser.create({ id: 1, name: 'Ana' });
      await LoggedUser.create({ id: 2, name: 'Juan' });
      await Promise.all(['tx-a', 'tx-b'].map((txId, index) => storage.run({ txId }, () => LoggedUser.findAll({ where: { id: index + 1 } }))));
      const queries = calls.filter(call => call.event.type === 'sql' && /SELECT.*WHERE/i.test(call.event.sql));
      assert.equal(queries.length, 2);
      for (const { args, event } of queries) {
        assert.equal(args.length, 3);
        assert.equal(args[1], event.params[0] === 1 ? 'tx-a' : 'tx-b');
        assert.ok(Number.isFinite(event.sqlDurationMs));
        assert.equal(typeof event.params[0], 'number');
      }
      const operation = calls.find(call => call.event.type === 'model-operation' && call.event.operation === 'create').event;
      assert.equal(operation.model, 'LoggedUser');
      assert.ok(Number.isFinite(operation.operationDurationMs));
      await assert.rejects(LoggedUser.create({ id: 3, name: 'Ana' }));
      assert.ok(calls.some(call => call.level === 'error' && call.event.type === 'sql' && call.event.error.stack));
      assert.ok(calls.some(call => call.level === 'error' && call.event.type === 'model-operation' && call.event.error.stack));
      const validation = Object.assign(new Error('required'), { code: 'VALIDATION_ERROR', errors: { name: 'required' }, details: { field: 'name' } });
      LoggedUser.addHook('beforeCreate', () => { throw validation; });
      await assert.rejects(LoggedUser.create({ id: 4, name: 'Rejected' }), error => error === validation);
      const logged = calls.find(call => call.event.error?.code === 'VALIDATION_ERROR').event.error;
      assert.deepEqual(logged.errors, validation.errors);
      assert.deepEqual(logged.details, validation.details);
      assert.equal(logged.stack, validation.stack);
      context.seq._slowQueryMs = 0;
      context.seq._slowOperationMs = 0;
      await LoggedUser.findAll();
      assert.ok(calls.some(call => call.level === 'warn' && call.event.type === 'sql'));
      assert.ok(calls.some(call => call.level === 'warn' && call.event.type === 'model-operation'));
      assert.ok(calls.every(call => typeof call.event === 'object' && call.args[0] === '[SEQ]'));
    } finally { await cleanupTestContext(context); }
  });

  it('normalizes SQL whitespace and emits cache events as structured data', async () => {
    const { calls, logging } = capture();
    const seq = new Seq({ adapter: new MapAdapter(), logging, cache: { ttl: 60 } });
    seq.adapter.ddl._measureSql('SELECT column\n FROM users', [], () => undefined);
    assert.equal(calls[0].event.sql, 'SELECT column FROM users');
    await seq.cache.get('User', 'findAll', {});
    const cache = calls.find(call => call.event.type === 'cache').event;
    assert.equal(cache.model, 'User');
    assert.equal(cache.operation, 'findAll');
    assert.equal(cache.hit, false);
    assert.equal(typeof cache.key, 'string');
  });
});
