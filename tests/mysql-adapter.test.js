import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Model, DataTypes, MySQLAdapter, MySQLError } from '../src/index.js';
import { ErrorAbstract } from '../src/adapters/abstract/ErrorAbstract.js';

describe('MySQL Adapter', () => {
  describe('adapter contract', () => {
    it('validates mysql2 dependency and reports when it is missing', async () => {
      const originalLoadClient = MySQLAdapter._loadClient;
      const errors = [];
      let loadCalls = 0;

      MySQLAdapter._loadClient = async () => {
        loadCalls++;
        throw Object.assign(new Error('Cannot find package "mysql2"'), {
          code: 'ERR_MODULE_NOT_FOUND'
        });
      };

      try {
        const mysql = new MySQLAdapter({ database: 'seq_test' });
        const seq = new Seq({
          adapter: mysql,
          logging: {
            info: false,
            error: (...args) => errors.push(args)
          }
        });

        await assert.rejects(
          () => mysql.validateDependencies(),
          error => {
            assert.ok(error instanceof MySQLError);
            assert.ok(error instanceof ErrorAbstract);
            assert.equal(error.name, 'MySQLError');
            assert.equal(error.code, 'SEQ_MYSQL_MISSING_DEPENDENCY');
            assert.match(error.message, /mysql2/);
            assert.equal(error.details.dependency, 'mysql2');
            return true;
          }
        );

        assert.equal(seq.adapter, mysql);
      } finally {
        MySQLAdapter._loadClient = originalLoadClient;
      }

      assert.equal(loadCalls, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], '[Seq]');
      assert.match(errors[0][1], /mysql2/);
    });

    it('exposes dependency validation without opening a connection', async () => {
      const mysql = new MySQLAdapter({ database: 'seq_test' });

      assert.equal(await mysql.validateDependencies(), true);
      assert.equal(mysql._pool, null);
    });

    it('quotes identifiers with backticks', () => {
      const mysql = new MySQLAdapter();

      assert.equal(mysql._quoteIdentifier('users'), '`users`');
      assert.equal(mysql._quoteIdentifier('we`ird'), '`we``ird`');
    });

    it('uses MySQL naming defaults', () => {
      const mysql = new MySQLAdapter();

      assert.deepEqual(mysql.naming, {
        tables: 'snake_case',
        columns: 'snake_case',
        prefix: undefined,
        caseStyle: 'lower',
        maxLength: 64
      });
    });

    it('passes pool sizing options to mysql2', () => {
      const mysql = new MySQLAdapter({ connectionLimit: 8, maxIdle: 3, idleTimeout: 45000 });

      assert.equal(mysql._connectionOptions.connectionLimit, 8);
      assert.equal(mysql._connectionOptions.maxIdle, 3);
      assert.equal(mysql._connectionOptions.idleTimeout, 45000);
    });

    it('maps Seq data types to MySQL types', () => {
      const mysql = new MySQLAdapter();

      assert.equal(mysql.mapDataType(DataTypes.INTEGER), 'INTEGER');
      assert.equal(mysql.mapDataType(DataTypes.STRING(100)), 'VARCHAR(100)');
      assert.equal(mysql.mapDataType(DataTypes.DECIMAL(12, 2)), 'DECIMAL(12, 2)');
      assert.equal(mysql.mapDataType(DataTypes.NUMBER()), 'DOUBLE');
      assert.equal(mysql.mapDataType(DataTypes.BOOLEAN), 'TINYINT(1)');
      assert.equal(mysql.mapDataType(DataTypes.DATE), 'DATETIME(3)');
      assert.equal(mysql.mapDataType(DataTypes.JSON), 'JSON');
    });

    it('hydrates MySQL decimal strings as numbers', () => {
      class User extends Model {}
      User.init(
        { balance: { type: DataTypes.DECIMAL(12, 2) } },
        { modelName: 'User', tableName: 'users', timestamps: false }
      );

      const mysql = new MySQLAdapter();
      mysql.schemas.set('users', {
        columns: User.rawAttributes,
        columnToAttr: { balance: 'balance' }
      });

      const [user] = mysql.dml._mapRows([{ balance: '0.00' }], User, mysql.schemas.get('users'));
      assert.equal(user.getDataValue('balance'), 0);
    });

    it('validates a pooled connection before handing it to SQL execution', async () => {
      const mysql = new MySQLAdapter();
      const calls = [];
      const stale = {
        async execute(sql) {
          calls.push(`stale:${sql}`);
          throw new Error('connection is closed');
        },
        destroy() { calls.push('stale:destroy'); },
        release() { calls.push('stale:release'); }
      };
      const healthy = {
        async execute(sql) {
          calls.push(`healthy:${sql}`);
          return [[{ ok: 1 }]];
        },
        release() { calls.push('healthy:release'); }
      };
      let checkout = 0;
      mysql._pool = { async getConnection() { return checkout++ === 0 ? stale : healthy; } };

      await mysql._withConnection(connection => connection.execute('SELECT data'));

      assert.deepEqual(calls, [
        'stale:SET SESSION wait_timeout = 300', 'stale:destroy',
        'healthy:SET SESSION wait_timeout = 300', 'healthy:SET SESSION interactive_timeout = 300', 'healthy:SELECT 1',
        'healthy:SELECT data', 'healthy:release'
      ]);
    });

    it('configures session timeouts once for a reused physical connection', async () => {
      const mysql = new MySQLAdapter();
      const calls = [];
      const physicalConnection = {};
      const connection = {
        connection: physicalConnection,
        async execute(sql) {
          calls.push(sql);
          return [[{ ok: 1 }]];
        },
        release() {}
      };
      mysql._pool = { async getConnection() { return { ...connection }; } };

      await mysql._withConnection(connection => connection.execute('SELECT first'));
      await mysql._withConnection(connection => connection.execute('SELECT second'));

      assert.deepEqual(calls, [
        'SET SESSION wait_timeout = 300', 'SET SESSION interactive_timeout = 300', 'SELECT 1', 'SELECT first',
        'SELECT 1', 'SELECT second'
      ]);
    });

    it('logs database execution errors through Seq before throwing', async () => {
      const errors = [];
      const mysql = new MySQLAdapter();
      new Seq({
        adapter: mysql,
        logging: { info: false, trace: false, error: (...args) => errors.push(args) }
      });
      mysql._pool = {
        async getConnection() {
          return {
            async execute(sql) {
              if (sql.startsWith('SET SESSION') || sql === 'SELECT 1') return [[{ ok: 1 }]];
              throw Object.assign(new Error("Column 'token' cannot be null"), { code: 'ER_BAD_NULL_ERROR' });
            },
            release() {}
          };
        }
      };

      await assert.rejects(() => mysql.dml._execute('INSERT INTO `sessions` () VALUES ()'), error => {
        assert.equal(error.name, 'MySQLError');
        assert.equal(error.message, "Column 'token' cannot be null");
        return true;
      });

      assert.equal(errors.length, 1);
      assert.equal(errors[0][1], 'INSERT INTO `sessions` () VALUES ()');
      assert.match(errors[0][3], /type:sql/);
      assert.match(errors[0][3], /Column token cannot be null/);
    });

    it('is exported from the public entrypoint', async () => {
      const mod = await import('../src/index.js');

      assert.equal(mod.MySQLAdapter, MySQLAdapter);
      assert.equal(mod.MySQLError, MySQLError);
    });
  });
});
