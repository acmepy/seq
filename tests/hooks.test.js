import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('DML hooks', () => {
  let seq, adapter, User;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
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
  });

  afterEach(async () => {
    await seq.close();
  });

  it('runs static create hooks without save hooks', async () => {
    const calls = [];
    User.addHook('beforeSave', () => calls.push('beforeSave'));
    User.addHook('beforeCreate', values => {
      calls.push('beforeCreate');
      values.name = values.name.toUpperCase();
    });
    User.addHook('afterCreate', user => calls.push(`afterCreate:${user.getDataValue('id')}`));
    User.addHook('afterSave', () => calls.push('afterSave'));

    const user = await User.create({ name: 'ana' });

    assert.equal(user.getDataValue('name'), 'ANA');
    assert.deepEqual(calls, ['beforeCreate', 'afterCreate:1']);
  });

  it('runs save hooks when saving an instance directly', async () => {
    const calls = [];
    User.addHook('beforeSave', user => {
      calls.push('beforeSave');
      user.setDataValue('name', user.getDataValue('name').toUpperCase());
    });
    User.addHook('beforeCreate', user => calls.push(`beforeCreate:${user.getDataValue('name')}`));
    User.addHook('afterCreate', user => calls.push(`afterCreate:${user.getDataValue('id')}`));
    User.addHook('afterSave', user => calls.push(`afterSave:${user.getDataValue('name')}`));

    const user = User.build({ name: 'ana' });
    await user.save();

    assert.equal(user.getDataValue('name'), 'ANA');
    assert.deepEqual(calls, ['beforeSave', 'beforeCreate:ANA', 'afterCreate:1', 'afterSave:ANA']);
  });

  it('runs find and count hooks and allows before hooks to change options', async () => {
    await User.bulkCreate([
      { name: 'Ana', active: true },
      { name: 'Juan', active: false }
    ]);
    const calls = [];

    User.addHook('beforeFind', options => {
      calls.push('beforeFind');
      options.where = { active: true };
    });
    User.addHook('afterFind', result => calls.push(`afterFind:${Array.isArray(result) ? result.length : 1}`));
    User.addHook('beforeCount', options => {
      calls.push('beforeCount');
      options.where = { active: false };
    });
    User.addHook('afterCount', count => calls.push(`afterCount:${count}`));

    const users = await User.findAll();
    const count = await User.count();

    assert.equal(users.length, 1);
    assert.equal(users[0].getDataValue('name'), 'Ana');
    assert.equal(count, 1);
    assert.deepEqual(calls, ['beforeFind', 'afterFind:1', 'beforeCount', 'afterCount:1']);
  });

  it('runs update, destroy, truncate, and bulk create hooks', async () => {
    const calls = [];
    User.addHook('beforeBulkCreate', records => {
      calls.push(`beforeBulkCreate:${records.length}`);
      records[0].name = 'Ana Maria';
    });
    User.addHook('afterBulkCreate', users => calls.push(`afterBulkCreate:${users.length}`));
    User.addHook('beforeUpdate', values => {
      calls.push('beforeUpdate');
      values.name = 'Updated';
    });
    User.addHook('afterUpdate', users => calls.push(`afterUpdate:${users.length}`));
    User.addHook('beforeDestroy', () => calls.push('beforeDestroy'));
    User.addHook('afterDestroy', count => calls.push(`afterDestroy:${count}`));
    User.addHook('beforeTruncate', () => calls.push('beforeTruncate'));
    User.addHook('afterTruncate', () => calls.push('afterTruncate'));

    await User.bulkCreate([{ name: 'Ana', active: true }, { name: 'Juan', active: false }]);
    await User.update({ name: 'Ignored' }, { where: { active: false } });
    const deleted = await User.destroy({ where: { name: 'Ana Maria' } });
    const updated = await User.findOne({ where: { name: 'Updated' } });
    await User.truncate();

    assert.equal(updated.getDataValue('name'), 'Updated');
    assert.equal(deleted, 1);
    assert.deepEqual(calls, [
      'beforeBulkCreate:2',
      'afterBulkCreate:2',
      'beforeUpdate',
      'afterUpdate:1',
      'beforeDestroy',
      'afterDestroy:1',
      'beforeTruncate',
      'afterTruncate'
    ]);
  });

  it('skips hooks when options.hooks is false', async () => {
    let calls = 0;
    User.addHook('beforeCreate', () => calls++);
    User.addHook('beforeFind', () => calls++);
    User.addHook('beforeUpdate', () => calls++);
    User.addHook('beforeDestroy', () => calls++);

    const user = await User.create({ name: 'Ana' }, { hooks: false });
    await User.findAll({ hooks: false });
    await user.update({ name: 'Ana Maria' }, { hooks: false });
    await user.destroy({ hooks: false });

    assert.equal(calls, 0);
  });
});
