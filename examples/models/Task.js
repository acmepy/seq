import { Model, DataTypes } from '../../src/index.js';

export class Task extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        title: {
          type: DataTypes.STRING(200),
          allowNull: false
        },
        priority: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0
        },
        completed: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
        userId: {
          type: DataTypes.INTEGER,
          allowNull: false
        }
      },
      {
        seq,
        modelName: 'Task',
        tableName: 'tasks',
        timestamps: true
      }
    );
  }
}
