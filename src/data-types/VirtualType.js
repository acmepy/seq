import { AbstractDataType } from './AbstractDataType.js';

/**
 * Virtual attribute type. It exists only at model-instance level and is never
 * materialized as a database column.
 */
export class VirtualType extends AbstractDataType {
  constructor(returnType = null, fields = []) {
    super('VIRTUAL', { returnType, fields });
    this.returnType = returnType;
    this.fields = fields;
  }

  toString() {
    if (!this.returnType) return 'VIRTUAL';
    return `VIRTUAL(${this.returnType})`;
  }

  validate() {
    return { valid: true, message: '' };
  }
}
