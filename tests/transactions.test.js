import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { MapAdapter } from '../src/adapters/map/MapAdapter.js';

describe('Transactions', () => {
  let seq;
  let User;

  beforeEach(async () => {
    class _User extends Model {}
    _User.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        balance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 }
      },
      { modelName: 'User', tableName: 'users', timestamps: false }
    );
    User = _User;

    seq = new Seq({
      adapter: new MapAdapter(),
      models: [User],
      logging: false
    });
    await seq.init();
    await seq.sync();
  });

  it('begin creates a transaction', async () => {
    const transaction = await seq.adapter.tcl.begin();
    assert.ok(transaction);
    assert.ok(transaction.active);
    assert.ok(transaction.id);
  });

  it('commit preserves changes', async () => {
    const transaction = await seq.adapter.tcl.begin();
    await User.create({ name: 'Ana', balance: 100 }, { transaction });
    await seq.adapter.tcl.commit(transaction);

    const count = await User.count();
    assert.equal(count, 1);
  });

  it('rollback reverts changes', async () => {
    const transaction = await seq.adapter.tcl.begin();
    await User.create({ name: 'Ana', balance: 100 }, { transaction });
    await seq.adapter.tcl.rollback(transaction);

    const count = await User.count();
    assert.equal(count, 0);
  });

  it('operations outside transaction are not affected by rollback', async () => {
    await User.create({ name: 'Juan', balance: 50 });

    const transaction = await seq.adapter.tcl.begin();
    await User.create({ name: 'Ana', balance: 100 }, { transaction });
    await seq.adapter.tcl.rollback(transaction);

    const count = await User.count();
    assert.equal(count, 1);

    const juan = await User.findOne({ where: { name: 'Juan' } });
    assert.ok(juan);
    assert.equal(juan.getDataValue('balance'), 50);
  });

  it('cannot commit an inactive transaction', async () => {
    const transaction = await seq.adapter.tcl.begin();
    await seq.adapter.tcl.commit(transaction);

    await assert.rejects(
      () => seq.adapter.tcl.commit(transaction),
      /not active/
    );
  });

  it('cannot rollback an inactive transaction', async () => {
    const transaction = await seq.adapter.tcl.begin();
    await seq.adapter.tcl.commit(transaction);

    await assert.rejects(
      () => seq.adapter.tcl.rollback(transaction),
      /not active/
    );
  });

  it('seq.transaction commits on success', async () => {
    await seq.transaction(async () => {
      await User.create({ name: 'Ana', balance: 100 });
    });

    const count = await User.count();
    assert.equal(count, 1);
  });

  it('seq.transaction rolls back on error', async () => {
    try {
      await seq.transaction(async () => {
        await User.create({ name: 'Ana', balance: 100 });
        throw new Error('Intentional error');
      });
    } catch (e) {
      // expected
    }

    const count = await User.count();
    assert.equal(count, 0);
  });
});
