export class Association {
  /**
   * @param {string} type - 'hasMany' | 'hasOne' | 'belongsTo' | 'belongsToMany'
   * @param {typeof import('./Model.js').Model} source
   * @param {typeof import('./Model.js').Model} target
   * @param {object} options
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
    this.otherKey = options.otherKey || null;
    this.constraintName = options.constraintName || null;
  }
}
