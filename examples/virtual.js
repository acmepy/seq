import { Seq } from '../src/index.js';
import { createExampleAdapter } from './adapter.js';
import { User } from './models/User.js';

const adapter = createExampleAdapter();
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User],
  logging: true
});

await seq.authenticate();
await seq.sync();

const ana = await User.create({
  name: 'Ana',
  email: 'ana@example.com'
});

console.log('\n--- Virtual getter ---');
console.log('  label:', ana.get('label'));
console.log('  toJSON:', ana.toJSON());

console.log('\n--- Virtual setter ---');
ana.setDataValue('label', 'Ana Demo <demo@example.com>');
await ana.save();

const updated = await User.findByPk(ana.get('id'));
console.log('  name:', updated.get('name'));
console.log('  email:', updated.get('email'));
console.log('  label:', updated.get('label'));

console.log('\n--- Schema columns ---');
const schema = seq.adapter.schemas.get('users');
console.log('  columns:', Object.keys(schema.columns));
console.log('  virtualAttributes:', schema.virtualAttributes);

await seq.close();
