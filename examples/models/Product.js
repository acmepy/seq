import { Model, DataTypes } from '../../src/index.js';

export class Product extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        productName: {
          type: DataTypes.STRING(100),
          allowNull: false,
          field: 'product_name'
        },
        unitPrice: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
          defaultValue: 0,
          field: 'unit_price'
        },
        inStock: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
          field: 'in_stock'
        }
      },
      {
        seq,
        modelName: 'Product',
        tableName: 'products',
        timestamps: true
      }
    );
  }
}
