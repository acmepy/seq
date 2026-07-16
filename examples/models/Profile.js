import { Model, DataTypes } from '../../src/index.js';

export class Profile extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        bio: {
          type: DataTypes.STRING(200)
        },
        userId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true
        }
      },
      {
        seq,
        modelName: 'Profile',
        tableName: 'profiles',
        timestamps: true
      }
    );
  }
}
