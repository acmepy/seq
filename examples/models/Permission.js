import { Model, DataTypes } from '../../src/index.js';

export class Permission extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        name: {
          type: DataTypes.STRING(50),
          allowNull: false
        }
      },
      {
        seq,
        modelName: 'Permission',
        tableName: 'permissions',
        timestamps: false
      }
    );
  }
}
