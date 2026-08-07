import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Seq } from '../src/core/Seq.js';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { SQLiteAdapter } from '../src/adapters/sqlite/SQLiteAdapter.js';

describe('Nested create with include', () => {
  let seq, Order, OrderDetail, Shipment, Product;

  async function createSeq(models) {
    const adapter = new SQLiteAdapter({ database: ':memory:' });
    await adapter.connect();
    seq = new Seq({ adapter, models, logging: false });
    await seq.init();
    await seq.sync();
  }

  beforeEach(async () => {
    class _Order extends Model {}
    _Order.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        total: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
      },
      { modelName: 'Order', tableName: 'orders', timestamps: false }
    );

    class _OrderDetail extends Model {}
    _OrderDetail.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        orderId: { type: DataTypes.INTEGER, allowNull: false },
        productId: { type: DataTypes.INTEGER, allowNull: false },
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
      },
      { modelName: 'OrderDetail', tableName: 'order_details', timestamps: false }
    );

    class _Shipment extends Model {}
    _Shipment.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        orderId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
        trackingCode: { type: DataTypes.STRING(50), allowNull: false }
      },
      { modelName: 'Shipment', tableName: 'shipments', timestamps: false }
    );

    class _Product extends Model {}
    _Product.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(50), allowNull: false }
      },
      { modelName: 'Product', tableName: 'products', timestamps: false }
    );

    Order = _Order;
    OrderDetail = _OrderDetail;
    Shipment = _Shipment;
    Product = _Product;

    Order.hasMany(OrderDetail, { foreignKey: 'orderId', as: 'OrderDetails' });
    Order.hasOne(Shipment, { foreignKey: 'orderId', as: 'Shipment' });
    OrderDetail.belongsTo(Order, { foreignKey: 'orderId' });
    await createSeq([Order, OrderDetail, Shipment, Product]);
  });

  afterEach(async () => {
    if (seq) await seq.close();
  });

  it('creates a parent with hasMany children from include payload', async () => {
    const order = await Order.create({
      total: 150,
      OrderDetails: [
        { productId: 1, quantity: 2, price: 50 },
        { productId: 2, quantity: 1, price: 50 }
      ]
    }, {
      include: [OrderDetail]
    });

    const orderId = order.getDataValue('id');
    const details = order.getDataValue('OrderDetails');
    assert.equal(details.length, 2);
    assert.ok(details.every(detail => detail.getDataValue('orderId') === orderId));
    assert.equal(await Order.count(), 1);
    assert.equal(await OrderDetail.count(), 2);
  });

  it('creates a parent with a hasOne child', async () => {
    const order = await Order.create({
      total: 75,
      Shipment: { trackingCode: 'TRK-1' }
    }, {
      include: [Shipment]
    });

    const shipment = order.getDataValue('Shipment');
    assert.ok(shipment);
    assert.equal(shipment.getDataValue('orderId'), order.getDataValue('id'));
    assert.equal(shipment.getDataValue('trackingCode'), 'TRK-1');
    assert.equal(await Shipment.count(), 1);
  });

  it('uses an explicit include alias for the nested payload key', async () => {
    const order = await Order.create({
      total: 20,
      items: [{ productId: 3, quantity: 1, price: 20 }]
    }, {
      include: [{ model: OrderDetail, as: 'items' }]
    });

    const items = order.getDataValue('items');
    assert.equal(items.length, 1);
    assert.equal(items[0].getDataValue('orderId'), order.getDataValue('id'));
  });

  it('rolls back the parent when a child create fails', async () => {
    await assert.rejects(
      () => Order.create({
        total: 150,
        OrderDetails: [
          { productId: 1, quantity: 2, price: 50 },
          { productId: 2, quantity: null, price: 50 }
        ]
      }, {
        include: [OrderDetail]
      })
    );

    assert.equal(await Order.count(), 0);
    assert.equal(await OrderDetail.count(), 0);
  });

  it('rejects belongsTo includes for nested create', async () => {
    await assert.rejects(
      () => OrderDetail.create({
        productId: 1,
        quantity: 1,
        price: 10,
        Order: { total: 10 }
      }, {
        include: [Order]
      }),
      error => error.code === 'SEQ_NESTED_CREATE_UNSUPPORTED_ASSOCIATION'
    );
  });

  it('rejects belongsToMany includes for nested create', async () => {
    Order.belongsToMany(Product, { through: 'order_products', foreignKey: 'orderId', otherKey: 'productId', as: 'Products' });
    await seq.sync();

    await assert.rejects(
      () => Order.create({
        total: 10,
        Products: [{ name: 'Keyboard' }]
      }, {
        include: [{ model: Product, as: 'Products' }]
      }),
      error => error.code === 'SEQ_NESTED_CREATE_UNSUPPORTED_ASSOCIATION'
    );
  });
});
