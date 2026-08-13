import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

describe('Nested update with include', () => {
  let context, seq, Order, OrderDetail, Shipment, Product, orderProductsTable;

  async function createSeq(models) {
    context = await createTestContext({ models });
    seq = context.seq;
    await seq.sync();
  }

  beforeEach(async () => {
    orderProductsTable = testTable('order_products');

    class _Order extends Model {}
    _Order.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        customer: { type: DataTypes.STRING(100), allowNull: false },
        total: { type: DataTypes.DECIMAL(10, 2), allowNull: false }
      },
      { modelName: 'Order', tableName: testTable('orders'), timestamps: false }
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
      { modelName: 'OrderDetail', tableName: testTable('order_details'), timestamps: false }
    );

    class _Shipment extends Model {}
    _Shipment.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        orderId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
        trackingCode: { type: DataTypes.STRING(50), allowNull: false }
      },
      { modelName: 'Shipment', tableName: testTable('shipments'), timestamps: false }
    );

    class _Product extends Model {}
    _Product.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(50), allowNull: false }
      },
      { modelName: 'Product', tableName: testTable('products'), timestamps: false }
    );

    Order = _Order;
    OrderDetail = _OrderDetail;
    Shipment = _Shipment;
    Product = _Product;

    Order.hasMany(OrderDetail, { foreignKey: 'orderId', as: 'detalles' });
    Order.hasOne(Shipment, { foreignKey: 'orderId', as: 'shipment' });
    OrderDetail.belongsTo(Order, { foreignKey: 'orderId' });
    await createSeq([Order, OrderDetail, Shipment, Product]);
  });

  afterEach(async () => {
    await cleanupTestContext(context);
    context = null;
    seq = null;
  });

  async function seedOrder() {
    const order = await Order.create({ customer: 'Ana', total: 100 });
    const orderId = order.getDataValue('id');
    await OrderDetail.bulkCreate([
      { orderId, productId: 1, quantity: 1, price: 40 },
      { orderId, productId: 2, quantity: 2, price: 30 }
    ]);
    await Shipment.create({ orderId, trackingCode: 'OLD' });
    return order;
  }

  it('updates a parent by primary key value and replaces hasMany children', async () => {
    const original = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.update({
      id: orderId,
      customer: 'Juan Perez',
      total: 150,
      detalles: [
        { productId: 1, quantity: 3, price: 50 },
        { productId: 2, quantity: 4, price: 50 }
      ]
    }, {
      include: [{ model: OrderDetail, as: 'detalles' }]
    });

    assert.equal(order.getDataValue('customer'), 'Juan Perez');
    assert.equal(order.getDataValue('total'), 150);
    const detalles = order.getDataValue('detalles');
    assert.equal(detalles.length, 2);
    assert.deepEqual(detalles.map(d => d.getDataValue('quantity')), [3, 4]);
    assert.ok(detalles.every(d => d.getDataValue('orderId') === orderId));

    const stored = await OrderDetail.findAll({ where: { orderId }, order: [['productId', 'ASC']] });
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map(d => d.getDataValue('quantity')), [3, 4]);
  });

  it('updates a parent using options.where and replaces hasMany children', async () => {
    const original = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.update({
      customer: 'Maria',
      total: 200,
      detalles: [{ productId: 5, quantity: 1, price: 200 }]
    }, {
      where: { id: orderId },
      include: [{ model: OrderDetail, as: 'detalles' }]
    });

    assert.equal(order.getDataValue('customer'), 'Maria');
    assert.equal(order.getDataValue('detalles').length, 1);
    assert.equal(order.getDataValue('detalles')[0].getDataValue('productId'), 5);
    assert.equal(await OrderDetail.count({ where: { orderId } }), 1);
  });

  it('replaces a hasOne child', async () => {
    const original = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.update({
      id: orderId,
      customer: 'Ana',
      total: 120,
      shipment: { trackingCode: 'NEW' }
    }, {
      include: [{ model: Shipment, as: 'shipment' }]
    });

    const shipment = order.getDataValue('shipment');
    assert.equal(shipment.getDataValue('trackingCode'), 'NEW');
    assert.equal(shipment.getDataValue('orderId'), orderId);
    assert.equal(await Shipment.count({ where: { orderId } }), 1);
  });

  it('deletes hasMany children when the nested payload is empty', async () => {
    const original = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.update({
      id: orderId,
      customer: 'Ana',
      total: 100,
      detalles: []
    }, {
      include: [{ model: OrderDetail, as: 'detalles' }]
    });

    assert.deepEqual(order.getDataValue('detalles'), []);
    assert.equal(await OrderDetail.count({ where: { orderId } }), 0);
  });

  it('rolls back parent and children when a replacement child fails', async () => {
    const original = await seedOrder();
    const orderId = original.getDataValue('id');

    await assert.rejects(
      () => Order.update({
        id: orderId,
        customer: 'Rollback',
        total: 999,
        detalles: [{ productId: 3, quantity: null, price: 10 }]
      }, {
        include: [{ model: OrderDetail, as: 'detalles' }]
      })
    );

    const order = await Order.findByPk(orderId);
    const detalles = await OrderDetail.findAll({ where: { orderId }, order: [['productId', 'ASC']] });
    assert.equal(order.getDataValue('customer'), 'Ana');
    assert.equal(order.getDataValue('total'), 100);
    assert.deepEqual(detalles.map(d => d.getDataValue('quantity')), [1, 2]);
  });

  it('rejects belongsTo includes for nested update', async () => {
    await seedOrder();
    await assert.rejects(
      () => OrderDetail.update({
        id: 1,
        productId: 1,
        quantity: 1,
        price: 10,
        Order: { customer: 'Bad', total: 10 }
      }, {
        include: [Order]
      }),
      error => error.code === 'SEQ_NESTED_CREATE_UNSUPPORTED_ASSOCIATION'
    );
  });

  it('rejects belongsToMany includes for nested update', async () => {
    Order.belongsToMany(Product, { through: orderProductsTable, foreignKey: 'orderId', otherKey: 'productId', as: 'products' });
    await seq.sync();
    const original = await seedOrder();

    await assert.rejects(
      () => Order.update({
        id: original.getDataValue('id'),
        customer: 'Ana',
        total: 100,
        products: [{ name: 'Keyboard' }]
      }, {
        include: [{ model: Product, as: 'products' }]
      }),
      error => error.code === 'SEQ_NESTED_CREATE_UNSUPPORTED_ASSOCIATION'
    );
  });
});
