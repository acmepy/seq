import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { ModelRegistry } from '../src/core/ModelRegistry.js';

describe('Model', () => {
  describe('init', () => {
    it('initializes a model with attributes', () => {
      class User extends Model {}
      User.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true },
          name: { type: DataTypes.STRING(100), allowNull: false }
        },
        { modelName: 'User', tableName: 'users', timestamps: false }
      );

      assert.equal(User.modelName, 'User');
      assert.equal(User.tableName, 'users');
      assert.equal(User.primaryKeyAttribute, 'id');
    });

    it('saves model options', () => {
      class Product extends Model {}
      Product.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true },
          price: { type: DataTypes.DECIMAL(10, 2) }
        },
        { modelName: 'Product', tableName: 'products', timestamps: true }
      );

      assert.equal(Product.options.timestamps, true);
    });

    it('detects autoIncrement field', () => {
      class Item extends Model {}
      Item.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(50) }
        },
        { modelName: 'Item', tableName: 'items', timestamps: false }
      );

      assert.equal(Item.autoIncrementAttribute, 'id');
    });

    it('adds timestamps when timestamps is true', () => {
      class Log extends Model {}
      Log.init(
        {
          message: { type: DataTypes.STRING(200) }
        },
        { modelName: 'Log', tableName: 'logs', timestamps: true }
      );

      assert.ok(Log.rawAttributes.createdAt);
      assert.ok(Log.rawAttributes.updatedAt);
    });

    it('does not add timestamps when timestamps is false', () => {
      class Config extends Model {}
      Config.init(
        {
          key: { type: DataTypes.STRING(100), primaryKey: true },
          value: { type: DataTypes.STRING(200) }
        },
        { modelName: 'Config', tableName: 'configs', timestamps: false }
      );

      assert.ok(!Config.rawAttributes.createdAt);
      assert.ok(!Config.rawAttributes.updatedAt);
    });

    it('allows custom timestamp field names', () => {
      class Event extends Model {}
      Event.init(
        {
          name: { type: DataTypes.STRING(100) }
        },
        {
          modelName: 'Event',
          tableName: 'events',
          timestamps: true,
          createdAt: 'created_at',
          updatedAt: 'updated_at'
        }
      );

      assert.ok(Event.rawAttributes.created_at);
      assert.ok(Event.rawAttributes.updated_at);
    });

    it('rejects attributes without type', () => {
      class Bad extends Model {}
      assert.throws(
        () => Bad.init({ name: { allowNull: false } }, { modelName: 'Bad' }),
        /must have a type/
      );
    });

    it('rejects more than one primaryKey', () => {
      class Bad extends Model {}
      assert.throws(
        () => Bad.init(
          {
            a: { type: DataTypes.INTEGER, primaryKey: true },
            b: { type: DataTypes.INTEGER, primaryKey: true }
          },
          { modelName: 'Bad' }
        ),
        /more than one primaryKey/
      );
    });

    it('rejects more than one autoIncrement', () => {
      class Bad extends Model {}
      assert.throws(
        () => Bad.init(
          {
            a: { type: DataTypes.INTEGER, autoIncrement: true },
            b: { type: DataTypes.INTEGER, autoIncrement: true }
          },
          { modelName: 'Bad' }
        ),
        /more than one autoIncrement/
      );
    });

    it('defaults modelName to class name', () => {
      class MyModel extends Model {}
      MyModel.init(
        { id: { type: DataTypes.INTEGER, primaryKey: true } },
        { timestamps: false }
      );
      assert.equal(MyModel.modelName, 'MyModel');
    });
  });

  describe('ModelRegistry', () => {
    let registry;

    beforeEach(() => {
      registry = new ModelRegistry();
    });

    it('registers and retrieves a model', () => {
      class User extends Model {}
      User.modelName = 'User';
      User.tableName = 'users';

      registry.register(User);
      assert.equal(registry.get('User'), User);
    });

    it('returns true for has when model exists', () => {
      class User extends Model {}
      User.modelName = 'User';
      registry.register(User);
      assert.ok(registry.has('User'));
    });

    it('returns false for has when model does not exist', () => {
      assert.ok(!registry.has('NonExistent'));
    });

    it('returns all registered models', () => {
      class User extends Model {}
      User.modelName = 'User';
      class Product extends Model {}
      Product.modelName = 'Product';

      registry.register(User);
      registry.register(Product);

      const all = registry.all();
      assert.equal(all.length, 2);
    });

    it('rejects duplicate model names', () => {
      class User1 extends Model {}
      User1.modelName = 'User';
      class User2 extends Model {}
      User2.modelName = 'User';

      registry.register(User1);
      assert.throws(
        () => registry.register(User2),
        /already registered/
      );
    });

    it('rejects duplicate table names', () => {
      class User1 extends Model {}
      User1.modelName = 'User1';
      User1.tableName = 'users';
      class User2 extends Model {}
      User2.modelName = 'User2';
      User2.tableName = 'users';

      registry.register(User1);
      assert.throws(
        () => registry.register(User2),
        /already used/
      );
    });

    it('rejects models without modelName', () => {
      class NoName extends Model {}
      assert.throws(
        () => registry.register(NoName),
        /must have a modelName/
      );
    });

    it('clears all models', () => {
      class User extends Model {}
      User.modelName = 'User';
      registry.register(User);
      registry.clear();
      assert.ok(!registry.has('User'));
      assert.equal(registry.all().length, 0);
    });
  });
});
