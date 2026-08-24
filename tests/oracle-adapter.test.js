import assert from 'node:assert/strict';
import test from 'node:test';
import { DataTypes, Model, Oracle11Adapter, Oracle11Error, Oracle12Adapter, Seq } from '../src/index.js';
import { ErrorAbstract } from '../src/adapters/abstract/ErrorAbstract.js';

test('Oracle adapters', async t => {
  await t.test('reports a missing oracledb dependency', async () => {
    const originalLoadClient = Oracle11Adapter._loadClient;
    const errors = [];
    Oracle11Adapter._loadClient = async () => {
      throw Object.assign(new Error('Cannot find package "oracledb"'), { code: 'ERR_MODULE_NOT_FOUND' });
    };

    try {
      const adapter = new Oracle11Adapter();
      new Seq({ adapter, logging: { info: false, error: (...args) => errors.push(args) } });
      await assert.rejects(() => adapter.validateDependencies(), error => {
        assert.ok(error instanceof Oracle11Error);
        assert.ok(error instanceof ErrorAbstract);
        assert.equal(error.name, 'Oracle11Error');
        assert.equal(error.code, 'SEQ_ORACLE_MISSING_DEPENDENCY');
        assert.match(error.message, /oracledb/);
        assert.equal(error.details.dependency, 'oracledb');
        return true;
      });
    } finally {
      Oracle11Adapter._loadClient = originalLoadClient;
    }

    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], '[Seq]');
    assert.match(errors[0][1], /oracledb/);
  });

  await t.test('rejects oracledb versions newer than 5.5.0', async () => {
    const originalLoadClient = Oracle11Adapter._loadClient;
    const errors = [];
    Oracle11Adapter._loadClient = async () => ({ versionString: '6.0.0' });

    try {
      const adapter = new Oracle11Adapter();
      new Seq({ adapter, logging: { info: false, error: (...args) => errors.push(args) } });
      await assert.rejects(() => adapter.validateDependencies(), error => {
        assert.ok(error instanceof Oracle11Error);
        assert.equal(error.code, 'SEQ_ORACLE_UNSUPPORTED_DEPENDENCY_VERSION');
        assert.equal(error.details.dependency, 'oracledb');
        assert.equal(error.details.version, '6.0.0');
        assert.equal(error.details.maxVersion, '5.5.0');
        return true;
      });
    } finally {
      Oracle11Adapter._loadClient = originalLoadClient;
    }

    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], '[Seq]');
    assert.match(errors[0][1], /5\.5\.0/);
  });

  await t.test('Oracle 11 maps JSON-like values to VARCHAR2 and dates to DATE', () => {
    const adapter = new Oracle11Adapter();
    assert.equal(adapter.mapDataType(DataTypes.OBJECT), 'VARCHAR2(4000)');
    assert.equal(adapter.mapDataType(DataTypes.ARRAY()), 'VARCHAR2(4000)');
    assert.equal(adapter.mapDataType(DataTypes.JSON), 'VARCHAR2(4000)');
    assert.equal(adapter.mapDataType(DataTypes.DATE), 'DATE');
  });

  await t.test('Oracle defaults to snake_case uppercase physical names', () => {
    const oracle11 = new Oracle11Adapter();
    const oracle12 = new Oracle12Adapter();

    assert.deepEqual(oracle11.naming, {
      tables: 'snake_case',
      columns: 'snake_case',
      maxLength: 30,
      prefix: undefined,
      caseStyle: 'upper'
    });
    assert.equal(oracle12.naming.caseStyle, 'upper');
  });

  await t.test('Oracle applies uppercase caseStyle to explicit physical names', async () => {
    class ExplicitUser extends Model {}
    ExplicitUser.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        firstName: { type: DataTypes.STRING(100), field: 'first_name' }
      },
      { modelName: 'ExplicitUser', tableName: 'explicit_users', timestamps: false }
    );

    const adapter = new Oracle11Adapter();
    const seq = new Seq({ adapter, models: [ExplicitUser], logging: false });
    ExplicitUser.seq = seq;
    ExplicitUser._resolvedTableName = seq._resolveTableName(ExplicitUser);
    const def = seq._buildTableDefinition(ExplicitUser);

    assert.equal(def.tableName, 'EXPLICIT_USERS');
    assert.equal(def.attrToColumn.firstName, 'FIRST_NAME');
  });

  await t.test('logs database execution errors through Seq before throwing', async () => {
    const errors = [];
    const adapter = new Oracle11Adapter();
    new Seq({ adapter, logging: { info: false, error: (...args) => errors.push(args) } });
    adapter._withConnection = async run => run({
      async execute() {
        throw Object.assign(new Error('ORA-01400: cannot insert NULL into ("SESSIONS"."TOKEN")'), { code: 'ORA-01400' });
      }
    });

    await assert.rejects(() => adapter.dml._execute('INSERT INTO "SESSIONS" ("TOKEN") VALUES (?)', [null]), error => {
      assert.equal(error.name, 'Oracle11Error');
      assert.match(error.message, /ORA-01400/);
      return true;
    });

    assert.deepEqual(errors, [['[Seq]', 'ORA-01400: cannot insert NULL into ("SESSIONS"."TOKEN")']]);
  });

  await t.test('Oracle 11 uses ROWNUM pagination and Oracle 12 extends it with OFFSET/FETCH', () => {
    const oracle11 = new Oracle11Adapter();
    const oracle12 = new Oracle12Adapter();
    assert.match(oracle11.dml._applyLimitOffset('SELECT * FROM users', { limit: 10, offset: 5 }), /ROWNUM/);
    assert.equal(oracle12 instanceof Oracle11Adapter, true);
    assert.equal(oracle12.dml._applyLimitOffset('SELECT * FROM users', { limit: 10, offset: 5 }), 'SELECT * FROM users OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY');
  });

  await t.test('Oracle 11 creates sequence-backed generated keys while Oracle 12 uses identity columns', () => {
    assert.equal(new Oracle11Adapter().dml._usesSequenceForAutoIncrement(), true);
    assert.equal(new Oracle12Adapter().dml._usesSequenceForAutoIncrement(), false);
  });
});
