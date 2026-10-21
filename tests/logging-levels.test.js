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
    assertLogEqual(calls[0].args, ['[Seq]', 'outside-before']);
    assertLogEqual(calls.at(-1).args, ['[Seq]', 'outside-after']);
    for (const { args } of calls.slice(1, -1)) {
      assertLogEqual(args, ['[Seq]', args[1], '{"value":1}', JSON.stringify({ txId: args[1] })]);
    }
    storage.run({}, () => seq._log('info', 'no-id'));
    assertLogEqual(calls.at(-1).args, ['[Seq]', 'no-id']);
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
      const sql = calls.filter(args => args[1]?.startsWith?.('SELECT') && /\bWHERE\b/i.test(args[1]));
      assert.equal(sql.length, 2);
      assertLogEqual(sql.map(args => JSON.parse(args.at(-1)).txId).sort(), ['tx-query-a', 'tx-query-b']);
      for (const args of sql) {
        assert.match(JSON.parse(args.at(-1)).txId, JSON.parse(args[2])[0] === 1 ? /tx-query-a/ : /tx-query-b/);
      }
      const operations = calls.filter(args => args[1] === 'ContextUser.findAll');
      assert.equal(operations.length, 2);
      assertLogEqual(operations.map(args => JSON.parse(args.at(-1)).txId).sort(), ['tx-query-a', 'tx-query-b']);
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

    assertLogEqual(logCalls, [
      ['[Seq]', 'ready'],
      ['[Seq]', 'hidden'],
      ['[Seq]', 'hidden']
    ]);
    assertLogEqual(errorCalls, [['[Seq]', 'failed']]);
  });

  it('keeps logging false fully silent', () => {
    const calls = [];
    const seq = new Seq({ adapter: new MapAdapter(), logging: false });

    seq._log('info', 'hidden');
    seq._log('error', 'hidden');

    assertLogEqual(calls, []);
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

    assertLogEqual(logCalls, []);
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

    assertLogEqual(calls, [
      ['trace', '[Seq]', 'sql'],
      ['warn', '[Seq]', 'heads up'],
      ['error', '[Seq]', 'boom']
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

    assertLogEqual(logger.calls, [['trace', '[Seq]', 'sql']]);
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

    assertLogEqual(calls, [{ target: console, args: ['[Seq]', 'sql'] }]);
  });

  it('stringifies object and array payloads as valid JSON', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: { info: (...args) => calls.push(args), trace: false, warn: false, error: false }
    });

    seq._log('info', 'payload', { name: 'Ana', meta: { role: 'admin' } }, ['one', 'two']);

    assertLogEqual(calls, [[
      '[Seq]',
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
      assertLogEqual(JSON.parse(operationLog[2]), {
        type: 'model-operation',
        operation: 'create',
        model: 'TimedUser',
        operationDurationMs: JSON.parse(operationLog[2]).operationDurationMs
      });
      assert.ok(Number.isFinite(JSON.parse(operationLog[2]).operationDurationMs));

      await assert.rejects(() => TimedUser.create({ name: 'Ana' }));
      assert.ok(errors.some(args => args[1]?.startsWith?.('INSERT INTO') && JSON.parse(args[3]).type === 'sql' && JSON.parse(args[3]).error));
      assert.ok(errors.some(args => args[1] === 'TimedUser.create' && JSON.parse(args[2]).type === 'model-operation' && JSON.parse(args[2]).error));
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

function assertLogEqual(actual, expected) {
  function normalize(value) {
    if (typeof value === 'string' && /^\[\d{4}-/.test(value)) {
      assert.match(value, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(INFO|TRACE|WARN|ERROR)\] \[SEQ\] \[[^\]\r\n]+\]$/);
      return '[Seq]';
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)]));
    return value;
  }
  assert.deepEqual(normalize(actual), expected);
}


it('formats levels, operations, local timestamps and single-line redacted data consistently', async () => {
  const calls = [];
  const logging = Object.fromEntries(['info', 'trace', 'warn', 'error'].map(level => [level, (...args) => calls.push({ level, args })]));
  const seq = new Seq({ adapter: new MapAdapter(), logging });
  seq._log('info', 'Seq initialized');
  seq._log('warn', 'Sync failed');
  seq._log('error', 'line one\nline two', { token: 'private', nested: { password: 'private' } });
  seq.adapter.ddl._measureSql('SELECT 1', [], () => undefined);
  const operations = ['init', 'sync', 'log', 'sql'];
  calls.forEach(({ level, args }, index) => {
    assert.match(args[0], /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    assert.ok(args[0].endsWith('[' + level.toUpperCase() + '] [SEQ] [' + operations[index] + ']'));
    assert.ok(!args.join(' ').includes('\n'));
    assert.ok(!args.join(' ').includes('private'));
  });
  assert.equal(calls[2].args[1], 'line one\\nline two');
  assert.deepEqual(JSON.parse(calls[2].args[2]), { token: '[REDACTED]', nested: { password: '[REDACTED]' } });
});
