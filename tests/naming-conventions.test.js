import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BaseAdapter } from '../src/adapters/BaseAdapter.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { toSnakeCase, toCamelCase, applyConvention, applyCase } from '../src/utils/naming.js';

describe('Naming Conventions', () => {

  describe('Utility functions', () => {
    describe('toSnakeCase', () => {
      it('converts PascalCase to snake_case', () => {
        assert.equal(toSnakeCase('User'), 'user');
        assert.equal(toSnakeCase('UserProfile'), 'user_profile');
      });

      it('converts camelCase to snake_case', () => {
        assert.equal(toSnakeCase('userName'), 'user_name');
        assert.equal(toSnakeCase('productName'), 'product_name');
        assert.equal(toSnakeCase('unitPrice'), 'unit_price');
      });

      it('handles consecutive uppercase letters', () => {
        assert.equal(toSnakeCase('parseJSON'), 'parse_json');
        assert.equal(toSnakeCase('HTMLParser'), 'html_parser');
      });

      it('handles single word', () => {
        assert.equal(toSnakeCase('id'), 'id');
        assert.equal(toSnakeCase('name'), 'name');
      });
    });

    describe('toCamelCase', () => {
      it('converts snake_case to camelCase', () => {
        assert.equal(toCamelCase('user_name'), 'userName');
        assert.equal(toCamelCase('product_name'), 'productName');
      });

      it('converts kebab-case to camelCase', () => {
        assert.equal(toCamelCase('user-name'), 'userName');
      });

      it('handles single word', () => {
        assert.equal(toCamelCase('user'), 'user');
      });

      it('handles already camelCase', () => {
        assert.equal(toCamelCase('userName'), 'userName');
      });
    });

    describe('applyConvention', () => {
      it('returns name unchanged when no convention', () => {
        assert.equal(applyConvention('userName', undefined), 'userName');
        assert.equal(applyConvention('userName', null), 'userName');
      });

      it('applies snake_case convention', () => {
        assert.equal(applyConvention('userName', 'snake_case'), 'user_name');
        assert.equal(applyConvention('ProductName', 'snake_case'), 'product_name');
      });

      it('applies camelCase convention', () => {
        assert.equal(applyConvention('user_name', 'camelCase'), 'userName');
        assert.equal(applyConvention('product_name', 'camelCase'), 'productName');
      });
    });

    describe('applyCase', () => {
      it('returns name unchanged when no caseStyle', () => {
        assert.equal(applyCase('user_name', undefined), 'user_name');
        assert.equal(applyCase('user_name', null), 'user_name');
      });

      it('applies lower case', () => {
        assert.equal(applyCase('USER_NAME', 'lower'), 'user_name');
        assert.equal(applyCase('UserName', 'lower'), 'username');
      });

      it('applies upper case', () => {
        assert.equal(applyCase('user_name', 'upper'), 'USER_NAME');
        assert.equal(applyCase('userName', 'upper'), 'USERNAME');
      });
    });
  });

  describe('Adapter naming configuration', () => {
    let adapter;

    beforeEach(() => {
      adapter = new SQLiteAdapter({ database: ':memory:' });
    });

    it('uses SQLite naming defaults', () => {
      assert.deepEqual(adapter.naming, {
        tables: 'snake_case',
        columns: 'snake_case',
        prefix: undefined,
        caseStyle: 'lower'
      });
    });

    it('uses Map naming defaults', () => {
      const map = new MapAdapter();
      assert.deepEqual(map.naming, {
        tables: 'camelCase',
        columns: 'camelCase',
        prefix: undefined,
        caseStyle: 'lower'
      });
    });

    it('uses BaseAdapter naming defaults', () => {
      const base = new BaseAdapter();
      assert.deepEqual(base.naming, {
        tables: undefined,
        columns: undefined,
        prefix: undefined,
        caseStyle: undefined
      });
    });

    it('accepts partial naming overrides in adapter options', () => {
      const sqlite = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'app', caseStyle: 'upper' }
      });
      assert.deepEqual(sqlite.naming, {
        tables: 'snake_case',
        columns: 'snake_case',
        prefix: 'app',
        caseStyle: 'upper'
      });
    });
  });

  describe('Table name conventions', () => {
    it('applies snake_case convention to table names', async () => {
      class Product extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            name: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'Product' });
        }
      }

      const adapter = new SQLiteAdapter({ database: ':memory:' });
      const seq = new Seq({
        adapter,
        models: [Product]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Product);
      assert.equal(def.tableName, 'product');
    });

    it('applies prefix to auto-generated table names', async () => {
      class User extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            name: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'User' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'app' }
      });
      const seq = new Seq({
        adapter,
        models: [User]
      });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.tableName, 'app_user');
    });

    it('applies lower caseStyle from naming to table names', async () => {
      class Order extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'Order' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { tables: 'camelCase', caseStyle: 'lower' }
      });
      const seq = new Seq({
        adapter,
        models: [Order]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Order);
      assert.equal(def.tableName, 'order');
    });

    it('applies upper caseStyle from naming to table names', async () => {
      class OrderItem extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'OrderItem' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { caseStyle: 'upper' }
      });
      const seq = new Seq({
        adapter,
        models: [OrderItem]
      });
      await seq.init();

      const def = seq._buildTableDefinition(OrderItem);
      assert.equal(def.tableName, 'ORDER_ITEM');
    });

    it('leaves table case unchanged when naming caseStyle is null', async () => {
      class UserProfile extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'user_profile' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { tables: 'camelCase', caseStyle: null }
      });
      const seq = new Seq({
        adapter,
        models: [UserProfile]
      });
      await seq.init();

      const def = seq._buildTableDefinition(UserProfile);
      assert.equal(def.tableName, 'userProfile');
    });

    it('uses BaseAdapter naming defaults without convention or case transform', async () => {
      class MixedCaseTable extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'MixedCaseTable' });
        }
      }

      const adapter = new BaseAdapter();
      const seq = new Seq({
        adapter,
        models: [MixedCaseTable]
      });
      await seq.init();

      const def = seq._buildTableDefinition(MixedCaseTable);
      assert.equal(def.tableName, 'MixedCaseTable');
    });

    it('uses MapAdapter camelCase lower defaults for table names', async () => {
      class UserProfile extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'user_profile' });
        }
      }

      const adapter = new MapAdapter();
      const seq = new Seq({
        adapter,
        models: [UserProfile]
      });
      await seq.init();

      const def = seq._buildTableDefinition(UserProfile);
      assert.equal(def.tableName, 'userprofile');
    });

    it('respects explicit tableName - no convention applied', async () => {
      class User extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'User', tableName: 'tbl_users' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'app' }
      });
      const seq = new Seq({
        adapter,
        models: [User]
      });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.tableName, 'tbl_users');
    });

    it('combines convention + prefix + naming caseStyle', async () => {
      class OrderItem extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
          }, { seq, modelName: 'OrderItem' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'app' }
      });
      const seq = new Seq({
        adapter,
        models: [OrderItem]
      });
      await seq.init();

      const def = seq._buildTableDefinition(OrderItem);
      assert.equal(def.tableName, 'app_order_item');
    });
  });

  describe('Column name conventions', () => {
    it('applies snake_case convention to column names', async () => {
      class Product extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            productName: { type: DataTypes.STRING(100) },
            unitPrice: { type: DataTypes.DECIMAL(10, 2) },
            inStock: { type: DataTypes.BOOLEAN }
          }, { seq, modelName: 'Product' });
        }
      }

      const adapter = new SQLiteAdapter({ database: ':memory:' });
      const seq = new Seq({
        adapter,
        models: [Product]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Product);
      assert.equal(def.attrToColumn.productName, 'product_name');
      assert.equal(def.attrToColumn.unitPrice, 'unit_price');
      assert.equal(def.attrToColumn.inStock, 'in_stock');
    });

    it('respects explicit field property - no convention applied', async () => {
      class Product extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            productName: { type: DataTypes.STRING(100), field: 'custom_name' }
          }, { seq, modelName: 'Product' });
        }
      }

      const adapter = new SQLiteAdapter({ database: ':memory:' });
      const seq = new Seq({
        adapter,
        models: [Product]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Product);
      assert.equal(def.attrToColumn.productName, 'custom_name');
    });

    it('applies lower caseStyle from naming to column names', async () => {
      class User extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            firstName: { type: DataTypes.STRING(100) },
            lastName: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'User' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { columns: 'camelCase', caseStyle: 'lower' }
      });
      const seq = new Seq({
        adapter,
        models: [User]
      });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.attrToColumn.firstName, 'firstname');
      assert.equal(def.attrToColumn.lastName, 'lastname');
    });

    it('applies upper caseStyle from naming to column names', async () => {
      class User extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            firstName: { type: DataTypes.STRING(100) },
            lastName: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'User' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { caseStyle: 'upper' }
      });
      const seq = new Seq({
        adapter,
        models: [User]
      });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.attrToColumn.firstName, 'FIRST_NAME');
      assert.equal(def.attrToColumn.lastName, 'LAST_NAME');
    });

    it('leaves column case unchanged when naming caseStyle is null', async () => {
      class User extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            first_name: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'User' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { columns: 'camelCase', caseStyle: null }
      });
      const seq = new Seq({
        adapter,
        models: [User]
      });
      await seq.init();

      const def = seq._buildTableDefinition(User);
      assert.equal(def.attrToColumn.first_name, 'firstName');
    });

    it('uses BaseAdapter naming defaults without column convention or case transform', async () => {
      class Product extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            productName: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'Product' });
        }
      }

      const adapter = new BaseAdapter();
      const seq = new Seq({
        adapter,
        models: [Product]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Product);
      assert.equal(def.attrToColumn.productName, 'productName');
    });

    it('uses MapAdapter camelCase lower defaults for column names', async () => {
      class Product extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            product_name: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'Product' });
        }
      }

      const adapter = new MapAdapter();
      const seq = new Seq({
        adapter,
        models: [Product]
      });
      await seq.init();

      const def = seq._buildTableDefinition(Product);
      assert.equal(def.attrToColumn.product_name, 'productname');
    });
  });

  describe('Integration with sync', () => {
    it('creates table with convention-applied name', async () => {
      class UserProfile extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            displayName: { type: DataTypes.STRING(100) }
          }, { seq, modelName: 'UserProfile' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'app' }
      });
      const seq = new Seq({
        adapter,
        models: [UserProfile]
      });
      await seq.init();
      const result = await seq.sync();

      assert.deepEqual(result.created, ['app_user_profile']);
      assert.ok(await adapter.ddl.hasTable('app_user_profile'));
    });

    it('CRUD works with convention-applied names', async () => {
      class OrderItem extends Model {
        static define(seq) {
          this.init({
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            orderNumber: { type: DataTypes.STRING(50) },
            totalPrice: { type: DataTypes.DECIMAL(10, 2) }
          }, { seq, modelName: 'OrderItem' });
        }
      }

      const adapter = new SQLiteAdapter({
        database: ':memory:',
        naming: { prefix: 'shop' }
      });
      const seq = new Seq({
        adapter,
        models: [OrderItem]
      });
      await seq.init();
      await seq.sync();

      const item = await OrderItem.create({
        orderNumber: 'ORD-001',
        totalPrice: 99.99
      });

      assert.ok(item);
      assert.equal(item.dataValues.orderNumber, 'ORD-001');
      assert.equal(item.dataValues.totalPrice, 99.99);

      const found = await OrderItem.findByPk(1);
      assert.ok(found);
      assert.equal(found.dataValues.orderNumber, 'ORD-001');

      const all = await OrderItem.findAll();
      assert.equal(all.length, 1);
    });
  });
});
