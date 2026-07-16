import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

describe('SQLite Adapter', () => {
  let seq, adapter;

  before(async () => {
    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
  });

  describe('adapter options', () => {
    it('accepts caseStyle, fkStrategy and eager overrides', () => {
      const sqlite = new SQLiteAdapter({
        database: ':memory:',
        caseStyle: 'upper',
        fkStrategy: 'none',
        eager: true
      });
      const map = new MapAdapter({
        caseStyle: null,
        fkStrategy: 'alter',
        eager: true
      });

      assert.equal(sqlite.caseStyle, 'upper');
      assert.equal(sqlite.fkStrategy, 'none');
      assert.equal(sqlite.eager, true);
      assert.equal(map.caseStyle, null);
      assert.equal(map.fkStrategy, 'alter');
      assert.equal(map.eager, true);
    });

    it('loads better-sqlite3 on connect and reports when it is missing', async () => {
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
            assert.equal(error.name, 'AdapterError');
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
  });

  after(async () => {
    await adapter.close();
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

      const exists = await adapter.ddl.hasTable('Dummy');
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
      assert.ok(tables.includes('Foo'));
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
        naming: { tables: 'snake_case', columns: 'snake_case' },
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
