/**
 * Base class for abstract adapter groups.
 */
export class BaseAbstract {
  constructor(adapter) {
    this._adapter = adapter;
  }

  _log(...args) {
    this._adapter?._log(...args);
  }
}
