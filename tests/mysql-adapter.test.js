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

    it('logs database execution errors through Seq before throwing', async () => {
      const errors = [];
      const mysql = new MySQLAdapter();
      new Seq({
        adapter: mysql,
        logging: { info: false, error: (...args) => errors.push(args) }
      });
      mysql._pool = {
        async execute() {
          throw Object.assign(new Error("Column 'token' cannot be null"), { code: 'ER_BAD_NULL_ERROR' });
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
