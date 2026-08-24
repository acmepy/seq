import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Model, DataTypes, MapAdapter } from '../src/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

describe('Logging levels', () => {
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
      ['[Seq]', 'ready'],
      ['[Seq]', 'hidden'],
      ['[Seq]', 'hidden']
    ]);
    assert.deepEqual(errorCalls, [['[Seq]', 'failed']]);
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

    assert.deepEqual(logger.calls, [['trace', '[Seq]', 'sql']]);
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

    assert.deepEqual(calls, [{ target: console, args: ['[Seq]', 'sql'] }]);
  });

  it('stringifies object and array payloads without quotes', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: { info: (...args) => calls.push(args), trace: false, warn: false, error: false }
    });

    seq._log('info', 'payload', { name: 'Ana', meta: { role: 'admin' } }, ['one', 'two']);

    assert.deepEqual(calls, [[
      '[Seq]',
      'payload',
      '{name:Ana,meta:{role:admin}}',
      '[one,two]'
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
      assert.match(sqlLog[3], /type:sql/);
      assert.match(sqlLog[3], /sqlDurationMs:/);

      const operationLog = trace.find(args => args[1] === 'TimedUser.create');
      assert.ok(operationLog, 'expected create operation trace');
      assert.match(operationLog[2], /type:model-operation/);
      assert.match(operationLog[2], /operation:create/);
      assert.match(operationLog[2], /model:TimedUser/);
      assert.match(operationLog[2], /operationDurationMs:/);

      await assert.rejects(() => TimedUser.create({ name: 'Ana' }));
      assert.ok(errors.some(args => args[1]?.startsWith?.('INSERT INTO') && /type:sql/.test(args[3]) && /error:/.test(args[3])));
      assert.ok(errors.some(args => args[1] === 'TimedUser.create' && /type:model-operation/.test(args[2]) && /error:/.test(args[2])));
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

      assert.ok(warn.some(args => args[1]?.startsWith?.('INSERT INTO') && /type:sql/.test(args[3])));
      assert.ok(warn.some(args => args[1] === 'SlowUser.create' && /type:model-operation/.test(args[2])));
    } finally {
      await cleanupTestContext(context);
    }
  });
});
