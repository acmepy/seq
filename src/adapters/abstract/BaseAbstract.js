/**
 * Base class for abstract adapter groups.
 */
export class BaseAbstract {
  constructor(adapter) {
    this._adapter = adapter;
  }

  _log(...args) {
    this._adapter?._seq?._log(...args);
  }
}
