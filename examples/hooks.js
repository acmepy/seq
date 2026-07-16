import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';

const hookLog = [];

function readValue(target, key) {
  return typeof target.getDataValue === 'function' ? target.getDataValue(key) : target[key];
}

function writeValue(target, key, value) {
  if (typeof target.setDataValue === 'function') {
    target.setDataValue(key, value);
    return;
  }
  target[key] = value;
}

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User],
  logging: false
});

await seq.init();
await seq.sync();

User.addHook('beforeCreate', userOrValues => {
  const email = readValue(userOrValues, 'email').trim().toLowerCase();
  writeValue(userOrValues, 'email', email);
  hookLog.push(`beforeCreate: ${email}`);
});

User.addHook('afterCreate', user => {
  hookLog.push(`afterCreate: id=${user.getDataValue('id')}`);
});

User.addHook('beforeSave', user => {
  const name = user.getDataValue('name').trim();
  user.setDataValue('name', name);
  hookLog.push(`beforeSave: ${name}`);
});

User.addHook('beforeFind', options => {
  options.where = { ...(options.where || {}), active: true };
  hookLog.push('beforeFind: active=true');
});

User.addHook('afterFind', result => {
  const count = Array.isArray(result) ? result.length : result ? 1 : 0;
  hookLog.push(`afterFind: ${count} result(s)`);
});

const ana = await User.create({
  name: 'Ana',
  email: ' ANA@EXAMPLE.COM '
});

const juan = User.build({
  name: '  Juan  ',
  email: 'juan@example.com',
  active: false
});
await juan.save();

console.log('Ana created with normalized email:', ana.toJSON());
console.log('Juan saved with trimmed name:', juan.toJSON());

const activeUsers = await User.findAll();
console.log('findAll with hooks:', activeUsers.map(user => user.toJSON()));

const allUsers = await User.findAll({ hooks: false });
console.log('findAll with hooks disabled:', allUsers.map(user => user.toJSON()));

console.log('Hook log:');
hookLog.forEach(entry => console.log(`- ${entry}`));

await seq.close();
await adapter.close();
