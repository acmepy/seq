import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Model CRUD', () => {
  let seq, adapter;
  let User;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(150), allowNull: false },
        balance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
      },
      { modelName: 'User', tableName: 'users', timestamps: true }
    );
    User = _User;

    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({
      adapter,
      models: [User],
      logging: false
    });
    await seq.init();
    await seq.sync();
  });

  afterEach(async () => {
    await seq.close();
  });

  describe('create', () => {
    it('creates a record and returns an instance', async () => {
      const user = await User.create({ name: 'Ana', email: 'ana@test.com' });
      assert.ok(user instanceof Model);
      assert.equal(user.getDataValue('name'), 'Ana');
      assert.equal(user.getDataValue('email'), 'ana@test.com');
    });

    it('generates auto-increment primary key', async () => {
      const user1 = await User.create({ name: 'Ana', email: 'a@test.com' });
      const user2 = await User.create({ name: 'Juan', email: 'j@test.com' });
      assert.ok(user1.getDataValue('id') < user2.getDataValue('id'));
    });

    it('applies default values', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      assert.equal(user.getDataValue('balance'), 0);
      assert.equal(user.getDataValue('active'), true);
    });

    it('applies timestamps', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      assert.ok(user.getDataValue('createdAt') instanceof Date);
      assert.ok(user.getDataValue('updatedAt') instanceof Date);
    });

    it('validates allowNull', async () => {
      await assert.rejects(
        () => User.create({ name: null, email: 'a@test.com' }),
        /does not allow null/
      );
    });

    it('validates types', async () => {
      await assert.rejects(
        () => User.create({ name: 'Ana', email: 'a@test.com', active: 'yes' }),
        /Expected a boolean/
      );
    });

    it('validates string length', async () => {
      const longName = 'A'.repeat(101);
      await assert.rejects(
        () => User.create({ name: longName, email: 'a@test.com' }),
        /exceeds maximum/
      );
    });
  });

  describe('findByPk', () => {
    it('finds a record by primary key', async () => {
      const created = await User.create({ name: 'Ana', email: 'a@test.com' });
      const found = await User.findByPk(created.getDataValue('id'));
      assert.ok(found);
      assert.equal(found.getDataValue('name'), 'Ana');
    });

    it('returns null for non-existent pk', async () => {
      const found = await User.findByPk(999999);
      assert.equal(found, null);
    });
  });

  describe('findOne', () => {
    it('finds one record matching where', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });

      const found = await User.findOne({ where: { name: 'Ana' } });
      assert.ok(found);
      assert.equal(found.getDataValue('email'), 'a@test.com');
    });

    it('returns null when no match', async () => {
      const found = await User.findOne({ where: { name: 'NonExistent' } });
      assert.equal(found, null);
    });
  });

  describe('findAll', () => {
    it('returns all records', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });

      const users = await User.findAll();
      assert.equal(users.length, 2);
    });

    it('supports where clause', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com', active: true });
      await User.create({ name: 'Juan', email: 'j@test.com', active: false });

      const active = await User.findAll({ where: { active: true } });
      assert.equal(active.length, 1);
      assert.equal(active[0].getDataValue('name'), 'Ana');
    });

    it('supports limit', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });
      await User.create({ name: 'Luis', email: 'l@test.com' });

      const users = await User.findAll({ limit: 2 });
      assert.equal(users.length, 2);
    });

    it('supports offset', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });
      await User.create({ name: 'Luis', email: 'l@test.com' });

      const users = await User.findAll({ offset: 1 });
      assert.equal(users.length, 2);
    });

    it('supports order', async () => {
      await User.create({ name: 'Juan', email: 'j@test.com' });
      await User.create({ name: 'Ana', email: 'a@test.com' });

      const users = await User.findAll({ order: [['name', 'ASC']] });
      assert.equal(users[0].getDataValue('name'), 'Ana');
      assert.equal(users[1].getDataValue('name'), 'Juan');
    });

    it('returns model instances', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      const users = await User.findAll();
      assert.ok(users[0] instanceof Model);
    });
  });

  describe('count', () => {
    it('returns correct count', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });

      const count = await User.count();
      assert.equal(count, 2);
    });

    it('counts with where clause', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com', active: true });
      await User.create({ name: 'Juan', email: 'j@test.com', active: false });

      const count = await User.count({ where: { active: true } });
      assert.equal(count, 1);
    });
  });

  describe('update', () => {
    it('updates matching records', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com', balance: 100 });
      await User.create({ name: 'Juan', email: 'j@test.com', balance: 200 });

      await User.update({ balance: 0 }, { where: { name: 'Ana' } });

      const ana = await User.findOne({ where: { name: 'Ana' } });
      assert.equal(ana.getDataValue('balance'), 0);
    });

    it('updates updatedAt timestamp', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      const originalUpdatedAt = user.getDataValue('updatedAt');

      await new Promise(r => setTimeout(r, 10));
      await User.update({ balance: 100 }, { where: { name: 'Ana' } });

      const updated = await User.findOne({ where: { name: 'Ana' } });
      assert.ok(updated.getDataValue('updatedAt') >= originalUpdatedAt);
    });

    it('returns updated instances', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com', balance: 100 });
      const results = await User.update({ balance: 200 }, { where: { name: 'Ana' } });
      assert.equal(results.length, 1);
      assert.equal(results[0].getDataValue('balance'), 200);
    });
  });

  describe('destroy', () => {
    it('deletes matching records', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });

      const count = await User.destroy({ where: { name: 'Ana' } });
      assert.equal(count, 1);

      const remaining = await User.findAll();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].getDataValue('name'), 'Juan');
    });
  });

  describe('truncate', () => {
    it('removes all records', async () => {
      await User.create({ name: 'Ana', email: 'a@test.com' });
      await User.create({ name: 'Juan', email: 'j@test.com' });

      await User.truncate();

      const count = await User.count();
      assert.equal(count, 0);
    });
  });

  describe('toJSON', () => {
    it('returns a plain object', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      const json = user.toJSON();
      assert.equal(typeof json, 'object');
      assert.equal(json.name, 'Ana');
      assert.equal(json.email, 'a@test.com');
    });

    it('returns a cloned object (no internal references)', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      const json = user.toJSON();
      json.name = 'Modified';
      assert.equal(user.getDataValue('name'), 'Ana');
    });
  });

  describe('Model instances', () => {
    it('save persists a new instance', async () => {
      const user = User.build({ name: 'Ana', email: 'a@test.com' });
      assert.ok(user._isNew);

      await user.save();
      assert.ok(!user._isNew);
      assert.ok(user.getDataValue('id'));
    });

    it('save updates an existing instance', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com', balance: 100 });
      user.setDataValue('balance', 200);
      await user.save();

      const found = await User.findByPk(user.getDataValue('id'));
      assert.equal(found.getDataValue('balance'), 200);
    });

    it('instance.update updates values and persists', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com', balance: 100 });
      await user.update({ balance: 300 });

      const found = await User.findByPk(user.getDataValue('id'));
      assert.equal(found.getDataValue('balance'), 300);
    });

    it('instance.destroy removes the record', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      const id = user.getDataValue('id');
      await user.destroy();

      const found = await User.findByPk(id);
      assert.equal(found, null);
    });

    it('getDataValue returns a value', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      assert.equal(user.getDataValue('name'), 'Ana');
    });

    it('setDataValue modifies the local value', async () => {
      const user = User.build({ name: 'Ana', email: 'a@test.com' });
      user.setDataValue('name', 'Juan');
      assert.equal(user.getDataValue('name'), 'Juan');
    });

    it('get returns a cloned object', async () => {
      const user = await User.create({ name: 'Ana', email: 'a@test.com' });
      const data = user.get();
      data.name = 'Modified';
      assert.equal(user.getDataValue('name'), 'Ana');
    });
  });

  describe('field mapping', () => {
    let seq2;
    let Product;

    beforeEach(async () => {
      class _Product extends Model {}
      _Product.init(
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
          productName: { type: DataTypes.STRING(100), allowNull: false, field: 'product_name' },
          unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, field: 'unit_price' },
          inStock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'in_stock' }
        },
        { modelName: 'Product', tableName: 'products', timestamps: false }
      );
      Product = _Product;

      seq2 = new Seq({ adapter, models: [Product], logging: false });
      await seq2.init();
      await seq2.sync();
    });

    it('stores records using column names', async () => {
      await Product.create({ productName: 'Laptop', unitPrice: 999.99 });
      const raw = adapter._db.prepare('SELECT * FROM products LIMIT 1').get();
      assert.ok('product_name' in raw);
      assert.ok('unit_price' in raw);
      assert.ok('in_stock' in raw);
      assert.ok(!('productName' in raw));
    });

    it('returns model instances with attribute names', async () => {
      const product = await Product.create({ productName: 'Laptop', unitPrice: 999.99 });
      assert.equal(product.getDataValue('productName'), 'Laptop');
      assert.equal(product.getDataValue('unitPrice'), 999.99);
      assert.equal(product.getDataValue('inStock'), true);
    });

    it('findByPk works with field mapping', async () => {
      const created = await Product.create({ productName: 'Mouse', unitPrice: 25.50 });
      const found = await Product.findByPk(created.getDataValue('id'));
      assert.ok(found);
      assert.equal(found.getDataValue('productName'), 'Mouse');
    });

    it('findAll with where works with field mapping', async () => {
      await Product.create({ productName: 'Laptop', unitPrice: 999.99, inStock: true });
      await Product.create({ productName: 'Cable', unitPrice: 5.00, inStock: false });

      const results = await Product.findAll({ where: { inStock: true } });
      assert.equal(results.length, 1);
      assert.equal(results[0].getDataValue('productName'), 'Laptop');
    });

    it('update works with field mapping', async () => {
      await Product.create({ productName: 'Laptop', unitPrice: 999.99 });
      await Product.update({ unitPrice: 899.99 }, { where: { productName: 'Laptop' } });

      const found = await Product.findOne({ where: { productName: 'Laptop' } });
      assert.equal(found.getDataValue('unitPrice'), 899.99);
    });

    it('destroy works with field mapping', async () => {
      await Product.create({ productName: 'Laptop', unitPrice: 999.99 });
      await Product.create({ productName: 'Mouse', unitPrice: 25.50 });

      await Product.destroy({ where: { productName: 'Laptop' } });
      const remaining = await Product.findAll();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].getDataValue('productName'), 'Mouse');
    });

    it('count works with field mapping', async () => {
      await Product.create({ productName: 'Laptop', unitPrice: 999.99, inStock: true });
      await Product.create({ productName: 'Cable', unitPrice: 5.00, inStock: false });

      const count = await Product.count({ where: { inStock: true } });
      assert.equal(count, 1);
    });

    it('findAll with order works with field mapping', async () => {
      await Product.create({ productName: 'Mouse', unitPrice: 25.50 });
      await Product.create({ productName: 'Laptop', unitPrice: 999.99 });

      const results = await Product.findAll({ order: [['productName', 'ASC']] });
      assert.equal(results[0].getDataValue('productName'), 'Laptop');
      assert.equal(results[1].getDataValue('productName'), 'Mouse');
    });

    it('instance.update works with field mapping', async () => {
      const product = await Product.create({ productName: 'Laptop', unitPrice: 999.99 });
      await product.update({ unitPrice: 799.99 });

      const found = await Product.findByPk(product.getDataValue('id'));
      assert.equal(found.getDataValue('unitPrice'), 799.99);
    });
  });

  describe('parameter validation', () => {
    describe('findAll', () => {
      it('rejects where as array', async () => {
        await assert.rejects(
          () => User.findAll({ where: [{ name: 'Ana' }] }),
          (err) => err.code === 'SEQ_VALIDATION_WHERE'
        );
      });

      it('rejects where as string', async () => {
        await assert.rejects(
          () => User.findAll({ where: 'name = Ana' }),
          (err) => err.code === 'SEQ_VALIDATION_WHERE'
        );
      });

      it('rejects order as string', async () => {
        await assert.rejects(
          () => User.findAll({ order: 'name ASC' }),
          (err) => err.code === 'SEQ_VALIDATION_ORDER'
        );
      });

      it('rejects limit as string', async () => {
        await assert.rejects(
          () => User.findAll({ limit: '10' }),
          (err) => err.code === 'SEQ_VALIDATION_LIMIT'
        );
      });

      it('rejects limit as 0', async () => {
        await assert.rejects(
          () => User.findAll({ limit: 0 }),
          (err) => err.code === 'SEQ_VALIDATION_LIMIT'
        );
      });

      it('rejects limit as negative', async () => {
        await assert.rejects(
          () => User.findAll({ limit: -1 }),
          (err) => err.code === 'SEQ_VALIDATION_LIMIT'
        );
      });

      it('rejects offset as string', async () => {
        await assert.rejects(
          () => User.findAll({ offset: '5' }),
          (err) => err.code === 'SEQ_VALIDATION_OFFSET'
        );
      });

      it('rejects offset as negative', async () => {
        await assert.rejects(
          () => User.findAll({ offset: -1 }),
          (err) => err.code === 'SEQ_VALIDATION_OFFSET'
        );
      });

      it('accepts offset as 0', async () => {
        const users = await User.findAll({ offset: 0 });
        assert.ok(Array.isArray(users));
      });
    });

    it('count rejects where as array', async () => {
      await assert.rejects(
        () => User.count({ where: [{ name: 'Ana' }] }),
        (err) => err.code === 'SEQ_VALIDATION_WHERE'
      );
    });

    it('update rejects where as array', async () => {
      await assert.rejects(
        () => User.update({ name: 'Ana' }, { where: [{ name: 'Juan' }] }),
        (err) => err.code === 'SEQ_VALIDATION_WHERE'
      );
    });

    it('destroy rejects where as array', async () => {
      await assert.rejects(
        () => User.destroy({ where: [{ name: 'Ana' }] }),
        (err) => err.code === 'SEQ_VALIDATION_WHERE'
      );
    });
  });

  describe('logging', () => {
    let logCalls;
    let loggingSeq;

    beforeEach(async () => {
      logCalls = [];
      loggingSeq = new Seq({
        adapter,
        models: [User],
        logging: (...args) => logCalls.push(args)
      });
      User.seq = loggingSeq;
      await loggingSeq.sync();
    });

    it('logs findAll with options', async () => {
      await User.findAll({ where: { active: true } });
      const findallLog = logCalls.find(args => args[1]?.includes?.('User.findAll'));
      assert.ok(findallLog, 'Expected a findAll log entry');
      assert.deepEqual(findallLog[2], { where: { active: true } });
    });

    it('logs findOne with options', async () => {
      await User.findOne({ where: { id: 1 } });
      const findOneLog = logCalls.find(args => args[1]?.includes?.('User.findOne'));
      assert.ok(findOneLog, 'Expected a findOne log entry');
    });

    it('logs findByPk with id', async () => {
      await User.findByPk(1);
      const findByPkLog = logCalls.find(args => args[1]?.includes?.('User.findByPk'));
      assert.ok(findByPkLog, 'Expected a findByPk log entry');
      assert.equal(findByPkLog[2], 1);
    });

    it('logs create with values', async () => {
      await User.create({ name: 'Test', email: 'test@test.com' });
      const createLog = logCalls.find(args => args[1]?.includes?.('User.create'));
      assert.ok(createLog, 'Expected a create log entry');
      assert.equal(createLog[2].name, 'Test');
    });

    it('logs count with options', async () => {
      await User.count({ where: { active: true } });
      const countLog = logCalls.find(args => args[1]?.includes?.('User.count'));
      assert.ok(countLog, 'Expected a count log entry');
    });

    it('logs update with values and options', async () => {
      await User.update({ name: 'Updated' }, { where: { id: 1 } });
      const updateLog = logCalls.find(args => args[1]?.includes?.('User.update'));
      assert.ok(updateLog, 'Expected an update log entry');
      assert.equal(updateLog[2].name, 'Updated');
    });

    it('logs destroy with options', async () => {
      await User.destroy({ where: { id: 1 } });
      const destroyLog = logCalls.find(args => args[1]?.includes?.('User.destroy'));
      assert.ok(destroyLog, 'Expected a destroy log entry');
    });

    it('logs truncate without options', async () => {
      await User.truncate();
      const truncateLog = logCalls.find(args => args[1]?.includes?.('User.truncate'));
      assert.ok(truncateLog, 'Expected a truncate log entry');
    });

    it('does not log when logging is false', async () => {
      logCalls = [];
      const silentSeq = new Seq({
        adapter,
        models: [User],
        logging: false
      });
      User.seq = silentSeq;
      await silentSeq.sync();
      await User.findAll();
      assert.equal(logCalls.length, 0);
    });
  });
});
