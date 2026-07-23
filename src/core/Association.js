import { ModelError } from './errors/ModelError.js';

export class Association {
  /**
   * @param {'hasMany'|'hasOne'|'belongsTo'|'belongsToMany'} type
   * @param {import('../../types/index.d.ts').ModelStatic} source
   * @param {import('../../types/index.d.ts').ModelStatic} target
   * @param {import('../../types/index.d.ts').AssociationOptions} options
   */
  constructor(type, source, target, options = {}) {
    const validActions = new Set(['RESTRICT', 'CASCADE', 'SET NULL']);
    for (const [name, value] of [['onDelete', options.onDelete], ['onUpdate', options.onUpdate]]) {
      if (value !== undefined && !validActions.has(value)) {
        throw new ModelError(`${name} must be RESTRICT, CASCADE or SET NULL`, { code: 'SEQ_ASSOCIATION_INVALID_ACTION' });
      }
    }
    this.type = type;
    this.source = source;
    this.target = target;
    this.foreignKey = options.foreignKey || null;
    this.as = options.as || null;
    this.onDelete = options.onDelete || 'RESTRICT';
    this.onUpdate = options.onUpdate || 'RESTRICT';
    this.through = options.through || null;
    this.throughModel = options.throughModel || null;
    this.throughTable = options.throughTable || options.through || null;
    this.otherKey = options.otherKey || null;
    this.constraintName = options.constraintName || null;
  }
}
