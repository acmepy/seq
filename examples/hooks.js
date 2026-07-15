import { Seq, SQLiteAdapter, Model, DataTypes } from '../src/index.js';

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

class Customer extends Model {
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
        active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        }
      },
      {
        seq,
        modelName: 'Customer',
        timestamps: false,
        hooks: {
          beforeCreate(customerOrValues) {
            const email = readValue(customerOrValues, 'email').trim().toLowerCase();
            writeValue(customerOrValues, 'email', email);
            hookLog.push(`beforeCreate: ${email}`);
          },
          afterCreate(customer) {
            hookLog.push(`afterCreate: id=${customer.getDataValue('id')}`);
          }
        }
      }
    );
  }
}

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [Customer],
  logging: false
});

await seq.init();
await seq.sync();

Customer.addHook('beforeSave', customer => {
  const name = customer.getDataValue('name').trim();
  customer.setDataValue('name', name);
  hookLog.push(`beforeSave: ${name}`);
});

Customer.addHook('beforeFind', options => {
  options.where = { ...(options.where || {}), active: true };
  hookLog.push('beforeFind: active=true');
});

Customer.addHook('afterFind', result => {
  const count = Array.isArray(result) ? result.length : result ? 1 : 0;
  hookLog.push(`afterFind: ${count} result(s)`);
});

const ana = await Customer.create({
  name: 'Ana',
  email: ' ANA@EXAMPLE.COM '
});

const juan = Customer.build({
  name: '  Juan  ',
  email: 'juan@example.com',
  active: false
});
await juan.save();

console.log('Ana created with normalized email:', ana.toJSON());
console.log('Juan saved with trimmed name:', juan.toJSON());

const activeCustomers = await Customer.findAll();
console.log('findAll with hooks:', activeCustomers.map(customer => customer.toJSON()));

const allCustomers = await Customer.findAll({ hooks: false });
console.log('findAll with hooks disabled:', allCustomers.map(customer => customer.toJSON()));

console.log('Hook log:');
hookLog.forEach(entry => console.log(`- ${entry}`));

await seq.close();
await adapter.close();
