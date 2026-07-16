import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';
import { Product } from './models/Product.js';

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Product],
  naming: {
    tables: 'snake_case',
    columns: 'snake_case'
  },
  logging: {
    info: console.log,
    trace: console.debug,
    warning: console.warn,
    error: console.error
  }
});

await seq.init();

const syncResult = await seq.sync();
console.log('Sync:', syncResult);

const ana = await User.create({
  name: 'Ana',
  email: 'ana@example.com',
  balance: 150.50,
  tags: ['admin', 'dev'],
  settings: { theme: 'dark' },
  metadata: { loginCount: 5 }
});

console.log('Ana:', ana.toJSON());

const laptop = await Product.create({productName: 'Laptop',unitPrice: 999.99});
const mouse = await Product.create({productName: 'Mouse',unitPrice: 25.50,inStock: false});
console.log('Laptop (attr names):', laptop.toJSON());

const productTable = Product._resolvedTableName;
const schema = seq._adapter.schemas.get(productTable);
console.log('Laptop attrToColumn:', schema.attrToColumn);
console.log('Laptop uniqueConstraints:', schema.uniqueConstraints);
console.log('Laptop foreignKeys:', schema.foreignKeys);

const found = await Product.findOne({ where: { productName: 'Laptop' } });
console.log('findOne by productName:', found.getDataValue('productName'), found.getDataValue('unitPrice'));

await laptop.update({ unitPrice: 899.99 });
console.log('Laptop updated:', laptop.toJSON());

try{
  const duplicate = await Product.create({productName: 'Mouse',unitPrice: 26.00,inStock: false});
}catch(e){
  console.log('test unique', e.message || e);
}
await Product.destroy({ where: { productName: 'Mouse' } });
console.log('Products after destroy:', (await Product.findAll()).map(p => p.toJSON()));

await seq.close();
await adapter.close();
