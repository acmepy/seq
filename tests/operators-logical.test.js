import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, Op, Model, DataTypes } from '../src/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

describe('Logical Operators and API Improvements', () => {
  let User, Profile;

  beforeEach(() => {
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

    class _Profile extends Model {}
    _Profile.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        bio: { type: DataTypes.STRING(255) }
      },
      { modelName: 'Profile', tableName: 'profiles', timestamps: false }
    );
    Profile = _Profile;
  });

  describe('hasOne singular default alias check', () => {
    it('sets options.as to singular instead of plural', () => {
      User.hasOne(Profile);
      const assoc = User.associations['Profile'];
      assert.equal(assoc.as, 'profile');
    });
  });

  for (const adapterType of ['SQLiteAdapter', 'MapAdapter']) {
    describe(`With ${adapterType}`, () => {
      let seq, adapter;

      beforeEach(async () => {
        if (adapterType === 'SQLiteAdapter') {
          adapter = new SQLiteAdapter({ database: ':memory:' });
        } else {
          adapter = new MapAdapter();
        }
        await adapter.connect();
        seq = new Seq({ adapter, models: [User, Profile], logging: false });
        await seq.init();
        await seq.sync();

        await User.create({ name: 'Ana', age: 25, active: true });
        await User.create({ name: 'Juan', age: 30, active: true });
        await User.create({ name: 'Luis', age: 35, active: false });
        await User.create({ name: 'Ana María', age: 28, active: true });
      });

      describe('findByPk checks', () => {
        it('returns null immediately when id is null or undefined', async () => {
          const resNull = await User.findByPk(null);
          assert.equal(resNull, null);

          const resUndef = await User.findByPk(undefined);
          assert.equal(resUndef, null);
        });
      });

      describe('Op.and', () => {
        it('filters correctly with Op.and array', async () => {
          const users = await User.findAll({
            where: {
              [Op.and]: [
                { name: { [Op.like]: '%Ana%' } },
                { age: { [Op.gt]: 26 } }
              ]
            }
          });
          assert.equal(users.length, 1);
          assert.equal(users[0].getDataValue('name'), 'Ana María');
        });

        it('filters correctly with implicit and combining fields', async () => {
          const users = await User.findAll({
            where: {
              name: { [Op.like]: '%Ana%' },
              age: { [Op.gt]: 26 }
            }
          });
          assert.equal(users.length, 1);
          assert.equal(users[0].getDataValue('name'), 'Ana María');
        });
      });

      describe('Op.or', () => {
        it('filters correctly with Op.or array', async () => {
          const users = await User.findAll({
            where: {
              [Op.or]: [
                { name: 'Juan' },
                { age: 35 }
              ]
            }
          });
          assert.equal(users.length, 2);
          const names = users.map(u => u.getDataValue('name')).sort();
          assert.deepEqual(names, ['Juan', 'Luis']);
        });

        it('filters correctly with nested Op.and and Op.or', async () => {
          const users = await User.findAll({
            where: {
              [Op.or]: [
                {
                  [Op.and]: [
                    { name: 'Ana' },
                    { active: true }
                  ]
                },
                {
                  [Op.and]: [
                    { name: 'Luis' },
                    { active: false }
                  ]
                }
              ]
            }
          });
          assert.equal(users.length, 2);
          const names = users.map(u => u.getDataValue('name')).sort();
          assert.deepEqual(names, ['Ana', 'Luis']);
        });
      });

      describe('bulkInsert transactional safety', () => {
        it('performs bulk insert correctly', async () => {
          const records = [
            { name: 'Carlos', age: 40, active: true },
            { name: 'Marta', age: 45, active: true }
          ];
          const results = await User.bulkCreate(records);
          assert.equal(results.length, 2);
          
          const carlos = await User.findOne({ where: { name: 'Carlos' } });
          assert.ok(carlos);
          assert.equal(carlos.getDataValue('age'), 40);
        });
      });
    });
  }
});
