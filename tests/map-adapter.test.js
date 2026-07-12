import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';
import { BaseAdapter } from '../src/adapters/BaseAdapter.js';
import { DataTypes } from '../src/data-types/index.js';

describe('MapAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new MapAdapter();
  });

  it('extends BaseAdapter', () => {
    assert.ok(adapter instanceof BaseAdapter);
  });

  it('initializes collections', () => {
    assert.ok(adapter.database instanceof Map);
    assert.ok(adapter.schemas instanceof Map);
    assert.ok(adapter.sequences instanceof Map);
  });

  it('has ddl, dml, dcl, tcl groups', () => {
    assert.ok(adapter.ddl);
    assert.ok(adapter.dml);
    assert.ok(adapter.dcl);
    assert.ok(adapter.tcl);
  });

  describe('DDL', () => {
    it('creates a table', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100) }
        },
        primaryKey: 'id',
        autoIncrement: 'id'
      });

      assert.ok(await adapter.ddl.hasTable('users'));
    });

    it('lists tables', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });
      await adapter.ddl.createTable({
        tableName: 'products',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      const tables = await adapter.ddl.listTables();
      assert.deepEqual(tables.sort(), ['products', 'users']);
    });

    it('describes a table', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: {
          id: { type: DataTypes.INTEGER, primaryKey: true },
          name: { type: DataTypes.STRING(100) }
        },
        primaryKey: 'id'
      });

      const desc = await adapter.ddl.describeTable('users');
      assert.equal(desc.tableName, 'users');
      assert.ok(desc.columns.id);
      assert.ok(desc.columns.name);
    });

    it('drops a table', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      await adapter.ddl.dropTable('users');
      assert.ok(!(await adapter.ddl.hasTable('users')));
    });

    it('throws on duplicate table creation', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      await assert.rejects(
        () => adapter.ddl.createTable({ tableName: 'users', columns: {} }),
        /already exists/
      );
    });

    it('throws on dropping non-existent table', async () => {
      await assert.rejects(
        () => adapter.ddl.dropTable('nonexistent'),
        /does not exist/
      );
    });

    it('alters table by adding missing columns', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      const altered = await adapter.ddl.alterTable('users', {
        columns: {
          id: { type: DataTypes.INTEGER, primaryKey: true },
          name: { type: DataTypes.STRING(100) }
        }
      });

      assert.ok(altered);
      const desc = await adapter.ddl.describeTable('users');
      assert.ok(desc.columns.name);
    });

    it('returns false when no changes needed in alterTable', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      const altered = await adapter.ddl.alterTable('users', {
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } }
      });

      assert.ok(!altered);
    });
  });

  describe('inspectDatabase', () => {
    it('returns database metadata', async () => {
      await adapter.ddl.createTable({
        tableName: 'users',
        columns: { id: { type: DataTypes.INTEGER, primaryKey: true } },
        primaryKey: 'id'
      });

      const info = await adapter.inspectDatabase();
      assert.deepEqual(info.tables, ['users']);
    });
  });

  describe('mapDataType', () => {
    it('maps INTEGER to string', () => {
      assert.equal(adapter.mapDataType(DataTypes.INTEGER), 'INTEGER');
    });

    it('maps STRING(100) to string', () => {
      assert.equal(adapter.mapDataType(DataTypes.STRING(100)), 'STRING(100)');
    });

    it('maps DECIMAL(12,2) to string', () => {
      assert.equal(adapter.mapDataType(DataTypes.DECIMAL(12, 2)), 'DECIMAL(12, 2)');
    });
  });

  describe('DCL', () => {
    it('throws on grant', async () => {
      await assert.rejects(
        () => adapter.dcl.grant(),
        /not supported/
      );
    });

    it('throws on revoke', async () => {
      await assert.rejects(
        () => adapter.dcl.revoke(),
        /not supported/
      );
    });
  });
});
