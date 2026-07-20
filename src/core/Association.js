export class Association {
  /**
   * @param {'hasMany'|'hasOne'|'belongsTo'|'belongsToMany'} type
   * @param {import('../../types/index.d.ts').ModelStatic} source
   * @param {import('../../types/index.d.ts').ModelStatic} target
   * @param {import('../../types/index.d.ts').AssociationOptions} options
   */
  constructor(type, source, target, options = {}) {
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
