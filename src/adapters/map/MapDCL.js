import { DCLAbstract } from '../abstract/DCLAbstract.js';

/**
 * DCL operations for the MapAdapter.
 * In-memory adapter does not support DCL — inherits default "not supported" from DCLAbstract.
 */
export class MapDCL extends DCLAbstract {
  constructor(adapter) {
    super(adapter);
  }
}
