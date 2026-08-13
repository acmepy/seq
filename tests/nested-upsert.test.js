import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/core/Model.js';
import { DataTypes } from '../src/data-types/index.js';
import { cleanupTestContext, createTestContext, testTable } from './shared/test-context.js';

describe('Nested upsert with include', () => {
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
    const first = await OrderDetail.create({ orderId, productId: 1, quantity: 1, price: 40 });
    const second = await OrderDetail.create({ orderId, productId: 2, quantity: 2, price: 30 });
    await Shipment.create({ orderId, trackingCode: 'OLD' });
    return { order, first, second };
  }

  it('creates a new parent with new hasMany children', async () => {
    const [order, created] = await Order.upsert({
      id: 10,
      customer: 'Juan',
      total: 150,
      detalles: [
        { id: 101, productId: 1, quantity: 3, price: 50 },
        { id: 102, productId: 2, quantity: 4, price: 50 }
      ]
    }, {
      include: [{ model: OrderDetail, as: 'detalles' }]
    });

    assert.equal(created, true);
    assert.equal(await Order.count(), 1);
    assert.equal(await OrderDetail.count(), 2);
    assert.equal(order.getDataValue('detalles').length, 2);
    assert.ok(order.getDataValue('detalles').every(detail => detail.getDataValue('orderId') === order.getDataValue('id')));
  });

  it('updates an existing parent and upserts only received children', async () => {
    const { order: original, first, second } = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order, created] = await Order.upsert({
      id: orderId,
      customer: 'Ana Maria',
      total: 175,
      detalles: [
        { id: first.getDataValue('id'), productId: 1, quantity: 5, price: 35 },
        { id: 999, productId: 3, quantity: 1, price: 100 }
      ]
    }, {
      include: [{ model: OrderDetail, as: 'detalles' }]
    });

    assert.equal(created, false);
    assert.equal(order.getDataValue('customer'), 'Ana Maria');
    assert.equal(order.getDataValue('detalles').length, 2);

    const stored = await OrderDetail.findAll({ where: { orderId }, order: [['productId', 'ASC']] });
    assert.equal(stored.length, 3);
    assert.deepEqual(stored.map(detail => detail.getDataValue('productId')), [1, 2, 3]);
    assert.deepEqual(stored.map(detail => detail.getDataValue('quantity')), [5, 2, 1]);
    assert.ok(stored.some(detail => detail.getDataValue('id') === second.getDataValue('id')));
  });

  it('upserts a hasOne child through its unique foreign key', async () => {
    const { order: original } = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.upsert({
      id: orderId,
      customer: 'Ana',
      total: 120,
      shipment: { trackingCode: 'NEW' }
    }, {
      include: [{ model: Shipment, as: 'shipment' }]
    });

    assert.equal(order.getDataValue('shipment').getDataValue('trackingCode'), 'NEW');
    assert.equal(await Shipment.count({ where: { orderId } }), 1);
  });

  it('does not delete an existing hasOne child when nested value is null', async () => {
    const { order: original } = await seedOrder();
    const orderId = original.getDataValue('id');

    const [order] = await Order.upsert({
      id: orderId,
      customer: 'Ana',
      total: 100,
      shipment: null
    }, {
      include: [{ model: Shipment, as: 'shipment' }]
    });

    assert.equal(order.getDataValue('shipment'), null);
    assert.equal(await Shipment.count({ where: { orderId } }), 1);
  });

  it('rolls back parent and child changes when a child upsert fails', async () => {
    const { order: original, first } = await seedOrder();
    const orderId = original.getDataValue('id');

    await assert.rejects(
      () => Order.upsert({
        id: orderId,
        customer: 'Rollback',
        total: 999,
        detalles: [
          { id: first.getDataValue('id'), productId: 1, quantity: 10, price: 10 },
          { productId: 4, quantity: null, price: 20 }
        ]
      }, {
        include: [{ model: OrderDetail, as: 'detalles' }]
      })
    );

    const order = await Order.findByPk(orderId);
    const detalles = await OrderDetail.findAll({ where: { orderId }, order: [['productId', 'ASC']] });
    assert.equal(order.getDataValue('customer'), 'Ana');
    assert.equal(order.getDataValue('total'), 100);
    assert.deepEqual(detalles.map(detail => detail.getDataValue('quantity')), [1, 2]);
  });

  it('rejects a child that cannot resolve an upsert target', async () => {
    const { order: original } = await seedOrder();

    await assert.rejects(
      () => Order.upsert({
        id: original.getDataValue('id'),
        customer: 'Ana',
        total: 100,
        detalles: [{ productId: 5, quantity: 1, price: 10 }]
      }, {
        include: [{ model: OrderDetail, as: 'detalles' }]
      }),
      error => error.code === 'SEQ_VALIDATION_UPSERT_TARGET'
    );
  });

  it('rejects belongsTo includes for nested upsert', async () => {
    await seedOrder();
    await assert.rejects(
      () => OrderDetail.upsert({
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

  it('rejects belongsToMany includes for nested upsert', async () => {
    Order.belongsToMany(Product, { through: orderProductsTable, foreignKey: 'orderId', otherKey: 'productId', as: 'products' });
    await seq.sync();
    const { order } = await seedOrder();

    await assert.rejects(
      () => Order.upsert({
        id: order.getDataValue('id'),
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
