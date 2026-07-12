import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * DCL operations for the MapAdapter.
 * Access control operations are not supported in the in-memory adapter.
 */
export class MapDCL {
  constructor(adapter) {
    this._adapter = adapter;
  }

  /**
   * Grant operation - not supported in MapAdapter.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async grant(...args) {
    throw new AdapterError(
      'DCL grant is not supported by the MapAdapter',
      { code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' }
    );
  }

  /**
   * Revoke operation - not supported in MapAdapter.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async revoke(...args) {
    throw new AdapterError(
      'DCL revoke is not supported by the MapAdapter',
      { code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' }
    );
  }
}
