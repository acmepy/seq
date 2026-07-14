import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Op, Model, DataTypes } from '../src/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Operators (Op)', () => {
  let seq, adapter, User;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        age: { type: DataTypes.INTEGER, allowNull: false },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
      },
      { modelName: 'User', tableName: 'users', timestamps: false }
    );
    User = _User;

    adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({ adapter, models: [User], logging: false });
    await seq.init();
    await seq.sync();

    await User.create({ name: 'Ana', age: 25, active: true });
    await User.create({ name: 'Juan', age: 30, active: true });
    await User.create({ name: 'Luis', age: 35, active: false });
    await User.create({ name: 'Ana María', age: 28, active: true });
  });

  describe('Op.eq', () => {
    it('works with explicit Op.eq', async () => {
      const users = await User.findAll({ where: { name: { [Op.eq]: 'Ana' } } });
      assert.equal(users.length, 1);
      assert.equal(users[0].getDataValue('name'), 'Ana');
    });
  });

  describe('Op.ne', () => {
    it('excludes matching records', async () => {
      const users = await User.findAll({ where: { name: { [Op.ne]: 'Ana' } } });
      assert.equal(users.length, 3);
      assert.ok(users.every(u => u.getDataValue('name') !== 'Ana'));
    });
  });

  describe('Op.gt', () => {
    it('filters greater than', async () => {
      const users = await User.findAll({ where: { age: { [Op.gt]: 28 } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => u.getDataValue('age') > 28));
    });
  });

  describe('Op.gte', () => {
    it('filters greater than or equal', async () => {
      const users = await User.findAll({ where: { age: { [Op.gte]: 28 } } });
      assert.equal(users.length, 3);
      assert.ok(users.every(u => u.getDataValue('age') >= 28));
    });
  });

  describe('Op.lt', () => {
    it('filters less than', async () => {
      const users = await User.findAll({ where: { age: { [Op.lt]: 28 } } });
      assert.equal(users.length, 1);
      assert.equal(users[0].getDataValue('name'), 'Ana');
    });
  });

  describe('Op.lte', () => {
    it('filters less than or equal', async () => {
      const users = await User.findAll({ where: { age: { [Op.lte]: 28 } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => u.getDataValue('age') <= 28));
    });
  });

  describe('Op.like', () => {
    it('matches with % wildcard', async () => {
      const users = await User.findAll({ where: { name: { [Op.like]: '%Ana%' } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => u.getDataValue('name').includes('Ana')));
    });

    it('matches with _ wildcard', async () => {
      const users = await User.findAll({ where: { name: { [Op.like]: 'An_' } } });
      assert.equal(users.length, 1);
      assert.equal(users[0].getDataValue('name'), 'Ana');
    });
  });

  describe('Op.notLike', () => {
    it('excludes matching patterns', async () => {
      const users = await User.findAll({ where: { name: { [Op.notLike]: '%Ana%' } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => !u.getDataValue('name').includes('Ana')));
    });
  });

  describe('Op.in', () => {
    it('matches values in array', async () => {
      const users = await User.findAll({ where: { name: { [Op.in]: ['Ana', 'Juan'] } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => ['Ana', 'Juan'].includes(u.getDataValue('name'))));
    });
  });

  describe('Op.notIn', () => {
    it('excludes values in array', async () => {
      const users = await User.findAll({ where: { name: { [Op.notIn]: ['Ana', 'Juan'] } } });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => !['Ana', 'Juan'].includes(u.getDataValue('name'))));
    });
  });

  describe('Op.between', () => {
    it('filters within range (inclusive)', async () => {
      const users = await User.findAll({ where: { age: { [Op.between]: [25, 30] } } });
      assert.equal(users.length, 3);
      assert.ok(users.every(u => u.getDataValue('age') >= 25 && u.getDataValue('age') <= 30));
    });
  });

  describe('Op.notBetween', () => {
    it('excludes values within range', async () => {
      const users = await User.findAll({ where: { age: { [Op.notBetween]: [25, 30] } } });
      assert.equal(users.length, 1);
      assert.equal(users[0].getDataValue('name'), 'Luis');
    });
  });

  describe('mixed operators', () => {
    it('combines operators with plain equality', async () => {
      const users = await User.findAll({
        where: {
          name: { [Op.like]: '%Ana%' },
          active: true
        }
      });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => u.getDataValue('active') === true));
    });

    it('combines multiple operators', async () => {
      const users = await User.findAll({
        where: {
          age: { [Op.gte]: 28 },
          name: { [Op.ne]: 'Luis' }
        }
      });
      assert.equal(users.length, 2);
      assert.ok(users.every(u => u.getDataValue('age') >= 28 && u.getDataValue('name') !== 'Luis'));
    });
  });

  describe('backward compatibility', () => {
    it('plain equality still works', async () => {
      const users = await User.findAll({ where: { name: 'Ana', active: true } });
      assert.equal(users.length, 1);
      assert.equal(users[0].getDataValue('name'), 'Ana');
    });
  });
});
