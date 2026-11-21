import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Oracle11Adapter, Oracle26Adapter, Seq } from '../src/index.js';

it('validates the installed Oracle 26 driver without changing the Oracle 11 version policy', async () => {
  const modern = new Oracle26Adapter();
  const legacy = new Oracle11Adapter();
  new Seq({ adapter: modern, logging: false });
  new Seq({ adapter: legacy, logging: false });
  assert.ok(modern instanceof Oracle11Adapter);
  assert.equal(await modern.validateDependencies(), true);
  assert.equal(modern._pool, null, 'Dependency validation must not open database connections');
  await assert.rejects(() => legacy.validateDependencies(), { code: 'SEQ_ORACLE_UNSUPPORTED_DEPENDENCY_VERSION' });
});

it('rejects an unsupported driver before Oracle26Adapter creates a pool', async () => {
  class UnsupportedDriver extends Oracle26Adapter {
    static async _loadClient() {
      return { versionString: '5.5.0', createPool() { throw new Error('Must not open a pool'); } };
    }
  }
  const adapter = new UnsupportedDriver();
  new Seq({ adapter, logging: false });
  await assert.rejects(() => adapter.connect(), { code: 'SEQ_ORACLE26_UNSUPPORTED_DEPENDENCY_VERSION' });
  assert.equal(adapter._pool, null);
});
