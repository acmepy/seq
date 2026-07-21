import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Model, DataTypes, MapAdapter, SQLiteAdapter } from '../src/index.js';

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

    assert.deepEqual(logCalls, [['[Seq]', 'ready']]);
    assert.deepEqual(errorCalls, [['[Seq]', 'failed']]);
  });

  it('keeps logging false fully silent', () => {
    const calls = [];
    const seq = new Seq({ adapter: new MapAdapter(), logging: false });

    seq._log('info', 'hidden');
    seq._log('error', 'hidden');

    assert.deepEqual(calls, []);
  });

  it('keeps function logging as an info logger', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: (...args) => calls.push(args)
    });

    seq._log('old style message');
    seq._log('trace', 'hidden');

    assert.deepEqual(calls, [['[Seq]', 'old style message']]);
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

  it('stringifies object and array payloads without quotes', () => {
    const calls = [];
    const seq = new Seq({
      adapter: new MapAdapter(),
      logging: (...args) => calls.push(args)
    });

    seq._log('info', 'payload', { name: 'Ana', meta: { role: 'admin' } }, ['one', 'two']);

    assert.deepEqual(calls, [[
      '[Seq]',
      'payload',
      '{name:Ana,meta:{role:admin}}',
      '[one,two]'
    ]]);
  });

  it('logs SQLite statements through trace', async () => {
    const calls = [];

    class User extends Model {}
    User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { modelName: 'User', tableName: 'users', timestamps: false }
    );

    const seq = new Seq({
      adapter: new SQLiteAdapter({ database: ':memory:' }),
      models: [User],
      logging: {
        info: false,
        trace: (...args) => calls.push(args),
        error: false
      }
    });

    await seq.init();
    await seq.sync();
    await User.create({ name: 'Ana' });
    await User.findAll();
    await seq.close();

    assert.ok(calls.some(args => args[1]?.startsWith?.('INSERT INTO')));
    assert.ok(calls.some(args => args[1]?.startsWith?.('SELECT')));
    assert.ok(calls.every(args => !String(args[2] || '').includes('sql:')));
  });
});
