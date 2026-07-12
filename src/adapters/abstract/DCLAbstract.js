import { BaseAbstract } from './BaseAbstract.js';
import { AdapterError } from '../../core/errors/AdapterError.js';

/**
 * Base DCL abstract.
 * Provides a default "not supported" implementation for adapters that don't support DCL.
 * Subclasses can override grant/revoke with real implementations.
 */
export class DCLAbstract extends BaseAbstract {
  /**
   * Grant privileges. Throws not supported by default.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async grant(...args) {
    throw new AdapterError('DCL grant is not supported by this adapter',{ code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' });
  }

  /**
   * Revoke privileges. Throws not supported by default.
   * @param {...*} args
   * @throws {AdapterError}
   */
  async revoke(...args) {
    throw new AdapterError( 'DCL revoke is not supported by this adapter', { code: 'SEQ_ADAPTER_DCL_NOT_SUPPORTED' } );
  }
}
