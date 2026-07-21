import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User],
  naming: {
    tables: 'snake_case',
    columns: 'snake_case'
  },
  logging: console.log
});

await seq.authenticate();
await seq.sync();

const ana = await User.create({
  name: 'Ana',
  email: 'ana@example.com'
});

console.log('\n--- Virtual getter ---');
console.log('  label:', ana.getDataValue('label'));
console.log('  toJSON:', ana.toJSON());

console.log('\n--- Virtual setter ---');
ana.setDataValue('label', 'Ana Demo <demo@example.com>');
await ana.save();

const updated = await User.findByPk(ana.getDataValue('id'));
console.log('  name:', updated.getDataValue('name'));
console.log('  email:', updated.getDataValue('email'));
console.log('  label:', updated.getDataValue('label'));

console.log('\n--- Schema columns ---');
const schema = seq.adapter.schemas.get('users');
console.log('  columns:', Object.keys(schema.columns));
console.log('  virtualAttributes:', schema.virtualAttributes);

await seq.close();
