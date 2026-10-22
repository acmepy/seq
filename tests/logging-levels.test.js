import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Seq, Model, DataTypes, MapAdapter } from '../src/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

describe('Logging levels', () => {
  it('rejects an invalid context provider and never reads it with logging disabled', () => {
    assert.throws(() => new Seq({ adapter: new MapAdapter(), getContext: {} }), { code: 'SEQ_INVALID_GET_CONTEXT' });
    const seq = new Seq({ adapter: new MapAdapter(), logging: false, getContext() { throw new Error('disabled'); } });
    assert.doesNotThrow(() => seq._log('trace', 'hidden'));
  });

  it('reads the active txId for every level without leaking other context fields', async () => {
    const storage = new AsyncLocalStorage();
    const calls = [];
    const logging = Object.fromEntries(['info', 'trace', 'warn', 'error'].map(level => [level, (...args) => calls.push({ level, args })]));
    const seq = new Seq({ adapter: new MapAdapter(), logging, getContext: () => storage.getStore() });
    seq._log('info', 'outside-before');
    await Promise.all(['tx-a', 'tx-b'].map(txId => storage.run({ txId, token: 'private' }, async () => {
      for (const level of ['info', 'trace', 'warn', 'error']) {
        await new Promise(resolve => setImmediate(resolve));
        seq._log(level, txId, { value: 1 });
      }
    })));
    seq._log('info', 'outside-after');
    assert.deepEqual(calls[0].args, ['[SEQ]', 'outside-before']);
    assert.deepEqual(calls.at(-1).args, ['[SEQ]', 'outside-after']);
    for (const { args } of calls.slice(1, -1)) {
      assert.deepEqual(args, ['[SEQ]', args[1], args[1], '{"value":1}']);
    }
    storage.run({}, () => seq._log('info', 'no-id'));
    assert.deepEqual(calls.at(-1).args, ['[SEQ]', 'no-id']);
  });

  it('includes the request txId in SQL and model logs using the active adapter', async () => {
    const storage = new AsyncLocalStorage();
    const calls = [];
    class ContextUser extends Model {}
    ContextUser.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, name: { type: DataTypes.STRING(50) } },
      { modelName: 'ContextUser', tableName: testTable('ctx_users'), timestamps: false });
    const context = await createTestContext({ models: [ContextUser], getContext: () => storage.getStore(),
      logging: { info: false, trace: (...args) => calls.push(args), warn: false, error: false },
      slowQueryMs: Number.MAX_VALUE, slowOperationMs: Number.MAX_VALUE });
    try {
      await context.seq.sync();
      calls.length = 0;
      await Promise.all(['tx-query-a', 'tx-query-b'].map((txId, index) => storage.run({ txId }, async () => {
        await ContextUser.findAll({ where: { id: index + 1 } });
      })));
      const sql = calls.filter(args => args[2]?.startsWith?.('SELECT') && /\bWHERE\b/i.test(args[2]));
      assert.equal(sql.length, 2);
      assert.deepEqual(sql.map(args => args[1]).sort(), ['tx-query-a', 'tx-query-b']);
      for (const args of sql) {
        assert.match(args[1], JSON.parse(args[3])[0] === 1 ? /tx-query-a/ : /tx-query-b/);
      }
      const operations = calls.filter(args => args[2] === 'ContextUser.findAll');
      assert.equal(operations.length, 2);
      assert.deepEqual(operations.map(args => args[1]).sort(), ['tx-query-a', 'tx-query-b']);
      calls.length = 0;
      await ContextUser.findAll();
      assert.ok(calls.length > 0);
      assert.ok(calls.every(args => !args.some(arg => String(arg).includes('tx-query-'))));
    } finally {
      await cleanupTestContext(context);
    }
  });
  it('uses info and error console handlers by default', () => {
    const originalLog = console.log;
    const originalError = console.error;
    const logCalls = [];
    const errorCalls = [];

    console.log = (...args) => logCalls.push(args);
    console.error = (...args) => errorCalls.push(args);

    try {
      const seq = new Seq({ adapter: new MapAdapter() });
      seq._log('info', 'ready');
      seq._log('error', 'failed');
      seq._log('trace', 'hidden');
      seq._log('warn', 'hidden');
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.deepEqual(logCalls, [
      ['[SEQ]', 'ready'],
      ['[SEQ]', 'hidden'],
      ['[SEQ]', 'hidden']
    ]);
    assert.deepEqual(errorCalls, [['[SEQ]', 'failed']]);
  });

  it('keeps logging false fully silent', () => {
    const calls = [];
    const seq = new Seq({ adapter: new MapAdapter(), logging: false });

    seq._log('info', 'hidden');
    seq._log('error', 'hidden');

    assert.deepEqual(calls, []);
  });

  it('does not support function logging', () => {
    const originalLog = console.log;
    const logCalls = [];

    console.log = (...args) => logCalls.push(args);

    try {
      const seq = new Seq({
        adapter: new MapAdapter(),
        logging: () => logCalls.push(['custom'])
      });

      seq._log('old style message');
      seq._log('trace', 'visible');
    } finally {
      console.log = originalLog;
    }

    assert.deepEqual(logCalls, []);
  });

  it('supports per-level logger objects', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: {
        info: false,
        trace: (...args) => calls.push(['trace', ...args]),
        warn: (...args) => calls.push(['warn', ...args]),
        error: (...args) => calls.push(['error', ...args])
      }
    });

    seq._log('info', 'hidden');
    seq._log('trace', 'sql');
    seq._log('warn', 'heads up');
    seq._log('error', 'boom');

    assert.deepEqual(calls, [
      ['trace', '[SEQ]', 'sql'],
      ['warn', '[SEQ]', 'heads up'],
      ['error', '[SEQ]', 'boom']
    ]);
  });

  it('accepts a logger instance directly and preserves its context', () => {
    const logger = {
      calls: [],
      info(...args) {
        this.calls.push(['info', ...args]);
      },
      trace(...args) {
        this.calls.push(['trace', ...args]);
      },
      warn(...args) {
        this.calls.push(['warn', ...args]);
      },
      error(...args) {
        this.calls.push(['error', ...args]);
      }
    };
    const seq = new Seq({ adapter: new MapAdapter(), logging: logger });

    seq._log('trace', 'sql');

    assert.deepEqual(logger.calls, [['trace', '[SEQ]', 'sql']]);
  });

  it('accepts console handlers in a per-level configuration', () => {
    const originalDebug = console.debug;
    const calls = [];
    console.debug = function (...args) {
      calls.push({ target: this, args });
    };

    try {
      const seq = new Seq({
        adapter: new MapAdapter(),
        logging: { info: console.log, trace: console.debug, warn: console.warn, error: console.error }
      });
      seq._log('trace', 'sql');
    } finally {
      console.debug = originalDebug;
    }

    assert.deepEqual(calls, [{ target: console, args: ['[SEQ]', 'sql'] }]);
  });

  it('stringifies object and array payloads as valid JSON', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: { info: (...args) => calls.push(args), trace: false, warn: false, error: false }
    });

    seq._log('info', 'payload', { name: 'Ana', meta: { role: 'admin' } }, ['one', 'two']);

    assert.deepEqual(calls, [[
      '[SEQ]',
      'payload',
      '{"name":"Ana","meta":{"role":"admin"}}',
      '["one","two"]'
    ]]);
  });

  it('logs SQL statements through trace', async () => {
    const calls = [];

    class User extends Model {}
    User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'User', tableName: testTable('users'), timestamps: false }
    );

    const context = await createTestContext({
      models: [User],
      logging: {
        info: false,
        trace: (...args) => calls.push(args),
        error: false
      }
    });
    const seq = context.seq;

    try {
      await seq.sync();
      await User.create({ name: 'Ana' });
      await User.findAll();
    } finally {
      await cleanupTestContext(context);
    }

    assert.ok(calls.some(args => args[1]?.startsWith?.('INSERT INTO')));
    assert.ok(calls.some(args => args[1]?.startsWith?.('SELECT')));
    assert.ok(calls.every(args => !String(args[2] || '').includes('sql:')));
  });

  it('normalizes multiline SQL into one log line', async () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: { info: false, trace: (...args) => calls.push(args), warn: false, error: false }
    });

    seq.adapter.ddl._measureSql('SELECT column\n  FROM users\n  WHERE id = ?', [1], () => undefined);

    assert.equal(calls[0][1], 'SELECT column FROM users WHERE id = ?');
  });

  it('logs sync failures before rethrowing them', async () => {
    const calls = [];
    const adapter = new MapAdapter();
    const failure = Object.assign(new Error('Cannot add required column'), {
      code: 'SEQ_DDL_REQUIRED_COLUMN_NEEDS_DEFAULT',
      details: { tableName: 'audit', field: 'xml' }
    });
    adapter.ddl.listTables = async () => {
      throw failure;
    };
    const seq = new Seq({
      adapter,
      logging: { info: false, trace: false, warn: false, error: (...args) => calls.push(args) }
    });

    await assert.rejects(() => seq.sync(), (error) => error === failure);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'Sync failed');
    assert.match(calls[0][2], /SEQ_DDL_REQUIRED_COLUMN_NEEDS_DEFAULT/);
    assert.match(calls[0][2], /Cannot add required column/);
    assert.equal(JSON.parse(calls[0][2]).error.stack, failure.stack);
  });

  it('logs SQL and model-operation durations through the active adapter', async () => {
    const trace = [];
    const errors = [];

    class TimedUser extends Model {}
    TimedUser.init(
      { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100), allowNull: false, unique: true } },
      { modelName: 'TimedUser', tableName: testTable('timed_users'), timestamps: false }
    );

    const context = await createTestContext({
      models: [TimedUser],
      logging: { info: false, trace: (...args) => trace.push(args), warn: false, error: (...args) => errors.push(args) },
      slowQueryMs: Number.MAX_VALUE,
      slowOperationMs: Number.MAX_VALUE
    });

    try {
      await context.seq.sync();
      trace.length = 0;
      await TimedUser.create({ name: 'Ana' });

      const sqlLog = trace.find(args => args[1]?.startsWith?.('INSERT INTO'));
      assert.ok(sqlLog, 'expected INSERT SQL trace');
      assert.equal(JSON.parse(sqlLog[3]).type, 'sql');
      assert.ok(Number.isFinite(JSON.parse(sqlLog[3]).sqlDurationMs));

      const operationLog = trace.find(args => args[1] === 'TimedUser.create');
      assert.ok(operationLog, 'expected create operation trace');
      assert.deepEqual(JSON.parse(operationLog[2]), {
        type: 'model-operation',
        operation: 'create',
        model: 'TimedUser',
        operationDurationMs: JSON.parse(operationLog[2]).operationDurationMs
      });
      assert.ok(Number.isFinite(JSON.parse(operationLog[2]).operationDurationMs));

      await assert.rejects(() => TimedUser.create({ name: 'Ana' }));
      assert.ok(errors.some(args => args[1]?.startsWith?.('INSERT INTO') && JSON.parse(args[3]).type === 'sql' && JSON.parse(args[3]).error));
      assert.ok(errors.some(args => args[1] === 'TimedUser.create' && JSON.parse(args[2]).type === 'model-operation' && JSON.parse(args[2]).error));
      for (const args of errors) {
        const metadata = args.map(value => {
          try { return JSON.parse(value); } catch { return null; }
        }).find(value => value?.error);
        assert.equal(typeof metadata.error.stack, 'string');
        assert.match(metadata.error.stack, /\bat /);
      }
    } finally {
      await cleanupTestContext(context);
    }
  });

  it('promotes slow SQL and model operations to warn', async () => {
    const warn = [];

    class SlowUser extends Model {}
    SlowUser.init(
      { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: DataTypes.STRING(100), allowNull: false } },
      { modelName: 'SlowUser', tableName: testTable('slow_users'), timestamps: false }
    );

    const context = await createTestContext({
      models: [SlowUser],
      logging: { info: false, trace: false, warn: (...args) => warn.push(args), error: false },
      slowQueryMs: 0,
      slowOperationMs: 0
    });

    try {
      await context.seq.sync();
      warn.length = 0;
      await SlowUser.create({ name: 'Ana' });

      assert.ok(warn.some(args => args[1]?.startsWith?.('INSERT INTO') && JSON.parse(args[3]).type === 'sql'));
      assert.ok(warn.some(args => args[1] === 'SlowUser.create' && JSON.parse(args[2]).type === 'model-operation'));
    } finally {
      await cleanupTestContext(context);
    }
  });
});

it('delegates timestamps and levels to the logger and keeps single-line redacted data', async () => {
  const calls = [];
  const logging = Object.fromEntries(['info', 'trace', 'warn', 'error'].map(level => [level, (...args) => calls.push({ level, args })]));
  const seq = new Seq({ adapter: new MapAdapter(), logging });
  seq._log('info', 'Seq initialized');
  seq._log('warn', 'Sync failed');
  seq._log('error', 'line one\nline two', { token: 'private', nested: { password: 'private' } });
  seq.adapter.ddl._measureSql('SELECT 1', [], () => undefined);
  calls.forEach(({ args }) => {
    assert.equal(args[0], '[SEQ]');
    assert.ok(!args.join(' ').includes('\n'));
    assert.ok(!args.join(' ').includes('private'));
  });
  assert.equal(calls[2].args[1], 'line one\\nline two');
  assert.deepEqual(JSON.parse(calls[2].args[2]), { token: '[REDACTED]', nested: { password: '[REDACTED]' } });
});


it('preserves stacks of Error payloads and nested errors while redacting secrets', () => {
  const calls = [];
  const seq = new Seq({ adapter: new MapAdapter(), logging: { info: false, trace: false, warn: false, error: (...args) => calls.push(args) } });
  const failure = Object.assign(new Error('Database failed'), { token: 'private' });
  seq._log('error', failure, { error: failure });
  for (const serialized of [JSON.parse(calls[0][1]), JSON.parse(calls[0][2]).error]) {
    assert.equal(serialized.stack, failure.stack);
    assert.equal(serialized.message, failure.message);
    assert.equal(serialized.token, '[REDACTED]');
  }
  assert.ok(!calls[0].join(' ').includes('\n'));
});
