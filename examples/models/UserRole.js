import { Model, DataTypes } from '../../src/index.js';

export class UserRole extends Model {
  static define(seq) {
    return this.init(
      {
        userId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'User', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE'
        },
        roleId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'Role', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE'
        },
        assignedBy: {
          type: DataTypes.STRING(100),
          allowNull: true
        }
      },
      {
        seq,
        modelName: 'UserRole',
        tableName: 'users_roles',
        timestamps: false
      }
    );
  }
}
