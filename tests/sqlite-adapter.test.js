import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { SQLiteError } from '../src/adapters/sqlite/SQLiteError.js';
import { ErrorAbstract } from '../src/adapters/abstract/ErrorAbstract.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

describe('SQLite Adapter', () => {
  let seq, adapter;

  before(async () => {
    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
  });

  describe('adapter options', () => {
    it('accepts fkStrategy and eager overrides', () => {
      const sqlite = new SQLiteAdapter({
        database: ':memory:',
        fkStrategy: 'none',
        eager: true
      });
      const map = new MapAdapter({
        fkStrategy: 'alter',
        eager: true
      });

      assert.equal(sqlite.fkStrategy, 'none');
      assert.equal(sqlite.eager, true);
      assert.equal(map.fkStrategy, 'alter');
      assert.equal(map.eager, true);
    });

    it('validates better-sqlite3 dependency and reports when it is missing', async () => {
      const originalLoadDatabase = SQLiteAdapter._loadDatabase;
      const errors = [];
      let loadCalls = 0;

      SQLiteAdapter._loadDatabase = async () => {
        loadCalls++;
        throw Object.assign(new Error('Cannot find package "better-sqlite3"'), {
          code: 'ERR_MODULE_NOT_FOUND'
        });
      };

      try {
        const sqlite = new SQLiteAdapter({ database: ':memory:' });
        const missingSeq = new Seq({
          adapter: sqlite,
          logging: {
            info: false,
            error: (...args) => errors.push(args)
          }
        });
        assert.equal(loadCalls, 0);

        await assert.rejects(
          () => missingSeq.init(),
          error => {
            assert.ok(error instanceof SQLiteError);
            assert.ok(error instanceof ErrorAbstract);
            assert.equal(error.name, 'SQLiteError');
            assert.equal(error.code, 'SEQ_SQLITE_MISSING_DEPENDENCY');
            assert.match(error.message, /better-sqlite3/);
            assert.equal(error.details.dependency, 'better-sqlite3');
            return true;
          }
        );
      } finally {
        SQLiteAdapter._loadDatabase = originalLoadDatabase;
      }

      assert.equal(loadCalls, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], '[Seq]');
      assert.match(errors[0][1], /better-sqlite3/);
    });

    it('exposes dependency validation without opening a connection', async () => {
      const sqlite = new SQLiteAdapter({ database: ':memory:' });

      assert.equal(await sqlite.validateDependencies(), true);
      assert.equal(sqlite._db, null);
    });

    it('authenticates by connecting and running a lightweight query', async () => {
      const sqlite = new SQLiteAdapter({ database: ':memory:' });
      const trace = [];
      const authSeq = new Seq({
        adapter: sqlite,
        logging: {
          info: false,
          trace: (...args) => trace.push(args),
          error: false
        }
      });

      try {
        const result = await authSeq.authenticate();

        assert.equal(result, true);
        assert.ok(sqlite._db);
        assert.deepEqual(sqlite._db.prepare('SELECT 1 AS ok').get(), { ok: 1 });
        assert.ok(trace.some(args => String(args[1]).includes('SELECT 1 AS ok')));
      } finally {
        await authSeq.close();
      }
    });

    it('initializes configured models during authenticate once', async () => {
      const sqlite = new SQLiteAdapter({ database: ':memory:' });

      class AuthUser extends Model {
        static define(seq) {
          return this.init(
            {
              id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
              name: { type: DataTypes.STRING(100), allowNull: false }
            },
            { seq, modelName: 'AuthUser', timestamps: false }
          );
        }
      }

      const authSeq = new Seq({ adapter: sqlite, models: [AuthUser], logging: false });

      try {
        await authSeq.authenticate();

        assert.equal(authSeq.hasModel('AuthUser'), true);
        assert.equal(AuthUser.seq, authSeq);

        await authSeq.authenticate();

        assert.equal(authSeq.models.length, 1);
      } finally {
        await authSeq.close();
      }
    });

    it('does not reconnect when authenticate is called on an active SQLite connection', async () => {
      const sqlite = new SQLiteAdapter({ database: ':memory:' });
      const authSeq = new Seq({ adapter: sqlite, logging: false });

      try {
        await authSeq.authenticate();
        const db = sqlite._db;

        await authSeq.authenticate();

        assert.equal(sqlite._db, db);
      } finally {
        await authSeq.close();
      }
    });
  });

  after(async () => {
    if (seq) await seq.close();
  });

  describe('basic CRUD', () => {
    it('create, findByPk, update, destroy', async () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(150) }
        },
        { modelName: 'User', timestamps: true }
      );

      seq = new Seq({ adapter, models: [User], logging: false });
      await seq.init();
      await seq.sync();

      const created = await User.create({ name: 'Ana', email: 'ana@test.com' });
      assert.ok(created.getDataValue('id'));
      assert.equal(created.getDataValue('name'), 'Ana');

      const found = await User.findByPk(created.getDataValue('id'));
      assert.equal(found.getDataValue('name'), 'Ana');
      assert.equal(found.getDataValue('email'), 'ana@test.com');

      await found.update({ name: 'Ana Maria' });
      const updated = await User.findByPk(created.getDataValue('id'));
      assert.equal(updated.getDataValue('name'), 'Ana Maria');

      await updated.destroy();
      const gone = await User.findByPk(created.getDataValue('id'));
      assert.equal(gone, null);
    });

    it('findAll with where', async () => {
      class Item extends Model {}
      Item.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100) },
          active: { type: DataTypes.BOOLEAN, defaultValue: true }
        },
        { modelName: 'Item' }
      );

      seq = new Seq({ adapter, models: [Item], logging: false });
      await seq.init();
      await seq.sync();

      await Item.bulkCreate([
        { title: 'A', active: true },
        { title: 'B', active: false },
        { title: 'C', active: true }
      ]);

      const active = await Item.findAll({ where: { active: 1 } });
      assert.equal(active.length, 2);

      const all = await Item.findAll();
      assert.equal(all.length, 3);

      const count = await Item.count({ where: { active: 1 } });
      assert.equal(count, 2);
    });

    it('auto-increment works', async () => {
      class Auto extends Model {}
      Auto.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          val: { type: DataTypes.STRING(50) }
        },
        { modelName: 'Auto' }
      );

      seq = new Seq({ adapter, models: [Auto], logging: false });
      await seq.init();
      await seq.sync();

      const a = await Auto.create({ val: 'a' });
      const b = await Auto.create({ val: 'b' });
      const c = await Auto.create({ val: 'c' });

      assert.equal(a.getDataValue('id'), 1);
      assert.equal(b.getDataValue('id'), 2);
      assert.equal(c.getDataValue('id'), 3);
    });

    it('timestamps are set automatically', async () => {
      class Ts extends Model {}
      Ts.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(50) }
        },
        { modelName: 'Ts', timestamps: true }
      );

      seq = new Seq({ adapter, models: [Ts], logging: false });
      await seq.init();
      await seq.sync();

      const rec = await Ts.create({ name: 'test' });
      assert.ok(rec.getDataValue('createdAt'));
      assert.ok(rec.getDataValue('updatedAt'));
    });
  });

  describe('constraint errors', () => {
    async function withConstraintAdapter(callback) {
      const sqlite = new SQLiteAdapter({ database: ':memory:' });
      await sqlite.connect();
      try {
        await callback(sqlite);
      } finally {
        await sqlite.close();
      }
    }

    async function assertConstraint(sqlite, action, name) {
      await assert.rejects(
        async () => action(),
        error => {
          assert.ok(error instanceof SQLiteError);
          assert.ok(error instanceof ErrorAbstract);
          assert.equal(error.name, 'SQLiteError');
          assert.equal(error.status, 409);
          assert.equal(error.code, 'CONFLICT');
          assert.equal(error.details.name, name);
          assert.ok(String(error.details.sqliteCode).startsWith('SQLITE_CONSTRAINT'));
          assert.equal(error.details.constraint.adapter, 'sqlite');
          return true;
        }
      );
    }

    it('maps UNIQUE constraint failed', async () => {
      await withConstraintAdapter(async sqlite => {
        sqlite.dml._execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)');
        sqlite.dml._execute('INSERT INTO users (email) VALUES (?)', ['ana@test.com']);

        await assertConstraint(
          sqlite,
          () => sqlite.dml._execute('INSERT INTO users (email) VALUES (?)', ['ana@test.com']),
          'UNIQUE constraint failed'
        );
      });
    });

    it('maps FOREIGN KEY constraint failed', async () => {
      await withConstraintAdapter(async sqlite => {
        sqlite.dml._execute('CREATE TABLE users (id INTEGER PRIMARY KEY)');
        sqlite.dml._execute('CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id))');

        await assertConstraint(
          sqlite,
          () => sqlite.dml._execute('INSERT INTO tasks (user_id) VALUES (?)', [1]),
          'FOREIGN KEY constraint failed'
        );
      });
    });

    it('maps NOT NULL constraint failed', async () => {
      await withConstraintAdapter(async sqlite => {
        sqlite.dml._execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

        await assertConstraint(
          sqlite,
          () => sqlite.dml._execute('INSERT INTO users (name) VALUES (?)', [null]),
          'NOT NULL constraint failed'
        );
      });
    });

    it('maps CHECK constraint failed', async () => {
      await withConstraintAdapter(async sqlite => {
        sqlite.dml._execute('CREATE TABLE users (id INTEGER PRIMARY KEY, age INTEGER CHECK (age >= 18))');

        await assertConstraint(
          sqlite,
          () => sqlite.dml._execute('INSERT INTO users (age) VALUES (?)', [17]),
          'CHECK constraint failed'
        );
      });
    });

    it('logs database execution errors through Seq before throwing', async () => {
      const errors = [];
      await withConstraintAdapter(async sqlite => {
        new Seq({ adapter: sqlite, logging: { info: false, error: (...args) => errors.push(args) } });
        sqlite.dml._execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

        assert.throws(() => sqlite.dml._execute('INSERT INTO users (name) VALUES (?)', [null]));
      });

      assert.equal(errors.length, 1);
      assert.equal(errors[0][0], '[Seq]');
      assert.match(errors[0][1], /NOT NULL constraint failed/);
    });
  });

  describe('DDL', () => {
    it('hasTable returns true for existing table', async () => {
      class Dummy extends Model {}
      Dummy.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true } },
        { modelName: 'Dummy' }
      );

      seq = new Seq({ adapter, models: [Dummy], logging: false });
      await seq.init();
      await seq.sync();

      const exists = await adapter.ddl.hasTable('dummy');
      assert.equal(exists, true);

      const notExists = await adapter.ddl.hasTable('nonexistent');
      assert.equal(notExists, false);
    });

    it('listTables returns created tables', async () => {
      class Foo extends Model {}
      Foo.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true } },
        { modelName: 'Foo' }
      );

      seq = new Seq({ adapter, models: [Foo], logging: false });
      await seq.init();
      await seq.sync();

      const tables = await adapter.ddl.listTables();
      assert.ok(tables.includes('foo'));
    });

    it('truncates data before dropping a table', async () => {
      const trace = [];
      const sqlite = new SQLiteAdapter({ database: ':memory:' });

      class Temp extends Model {}
      Temp.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } },
        { modelName: 'Temp', tableName: 'temps', timestamps: false }
      );

      const tracedSeq = new Seq({
        adapter: sqlite,
        models: [Temp],
        logging: {
          info: false,
          trace: (...args) => trace.push(args),
          error: false
        }
      });

      try {
        await tracedSeq.init();
        await tracedSeq.sync();
        await Temp.create({ id: 1 });

        await sqlite.ddl.dropTable('temps');

        assert.equal(await sqlite.ddl.hasTable('temps'), false);
        const sql = trace.map(args => args[1]?.sql || args[1]).filter(Boolean);
        const deleteIndex = sql.findIndex(entry => entry.includes('DELETE FROM') && entry.includes('temps'));
        const dropIndex = sql.findIndex(entry => entry.includes('DROP TABLE IF EXISTS') && entry.includes('temps'));
        assert.ok(deleteIndex >= 0, 'expected DELETE before DROP');
        assert.ok(dropIndex >= 0, 'expected DROP TABLE');
        assert.ok(deleteIndex < dropIndex, 'DELETE should run before DROP TABLE');
      } finally {
        await tracedSeq.close();
      }
    });
  });

  describe('naming conventions', () => {
    it('resolves snake_case table and column names', async () => {
      class UserProfile extends Model {}
      UserProfile.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          firstName: { type: DataTypes.STRING(100) },
          lastName: { type: DataTypes.STRING(100) }
        },
        { modelName: 'UserProfile' }
      );

      seq = new Seq({
        adapter,
        models: [UserProfile],
        logging: false
      });
      await seq.init();
      await seq.sync();

      const created = await UserProfile.create({ firstName: 'Ana', lastName: 'Garcia' });
      assert.ok(created.getDataValue('id'));

      const found = await UserProfile.findByPk(created.getDataValue('id'));
      assert.equal(found.getDataValue('firstName'), 'Ana');
      assert.equal(found.getDataValue('lastName'), 'Garcia');
    });
  });
});
