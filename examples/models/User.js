import { Model, DataTypes } from '../../src/index.js';

export class User extends Model {
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
          type: DataTypes.STRING(100),
          allowNull: false
        },
        email: {
          type: DataTypes.STRING(150),
          allowNull: false
        },
        balance: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0
        },
        active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        },
        tags: {
          type: DataTypes.ARRAY(DataTypes.STRING(50)),
          allowNull: true,
          defaultValue: () => []
        },
        settings: {
          type: DataTypes.OBJECT,
          allowNull: true,
          defaultValue: () => ({})
        },
        metadata: {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: () => ({})
        },
        label: {
          type: DataTypes.VIRTUAL(DataTypes.STRING(250), ['name', 'email']),
          get() {
            const name = this.getDataValue('name');
            const email = this.getDataValue('email');
            if (!name && !email) return null;
            if (!email) return name;
            if (!name) return email;
            return `${name} <${email}>`;
          },
          set(value) {
            const match = String(value).match(/^(.+?)\s*<([^>]+)>$/);
            if (match) {
              this.setDataValue('name', match[1].trim());
              this.setDataValue('email', match[2].trim());
              return;
            }
            this.setDataValue('name', String(value));
          }
        }
      },
      {
        seq,
        modelName: 'User',
        tableName: 'users',
        timestamps: true
      }
    );
  }
}
