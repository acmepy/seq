import { AsyncLocalStorage } from 'node:async_hooks';
import { DataTypes, Model, Seq, SQLiteAdapter } from '../src/index.js';

// In an application, api-kit supplies the authenticated request's tenantId here.
const requests = new AsyncLocalStorage();
const getContext = () => requests.getStore();

class Country extends Model {}
class Customer extends Model {}
class Note extends Model {}

Country.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, name: { type: DataTypes.STRING(80) } },
  { modelName: 'Country', tableName: 'countries', tenant: false, timestamps: false });
Customer.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, tenantId: { type: DataTypes.INTEGER, field: 'tenant_id' },
  countryId: { type: DataTypes.INTEGER }, name: { type: DataTypes.STRING(80) } },
{ modelName: 'Customer', tableName: 'customers', tenant: true, timestamps: false });
Note.init({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, company: { type: DataTypes.INTEGER, field: 'company_id' },
  customerId: { type: DataTypes.INTEGER }, text: { type: DataTypes.STRING(100) } },
{ modelName: 'Note', tableName: 'notes', tenant: { attribute: 'company' }, timestamps: false });
Country.hasMany(Customer, { as: 'customers', foreignKey: 'countryId' });
Customer.hasMany(Note, { as: 'notes', foreignKey: 'customerId' });
Note.belongsTo(Customer, { as: 'customer', foreignKey: 'customerId' });

const seq = new Seq({ adapter: new SQLiteAdapter({ database: ':memory:' }), models: [Country, Customer, Note],
  getContext, tenant: { attribute: 'tenantId' }, cache: { ttl: 60000 }, logging: false });

try {
  await seq.init();
  await seq.sync();
  await Country.create({ id: 1, name: 'Paraguay' });
  for (const tenantId of [1, 2]) await requests.run({ tenantId }, () => Customer.create({
    countryId: 1, name: `Customer ${tenantId}`, notes: [{ text: `Tenant ${tenantId} only` }]
  }, { include: [{ model: Note, as: 'notes' }] }));

  const results = await Promise.all([1, 2].map(tenantId => requests.run({ tenantId }, async () => {
    const countries = await Country.findAll({ include: [{ model: Customer, as: 'customers', include: [{ model: Note, as: 'notes' }] }], plain: true });
    return { tenantId, countries };
  })));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await seq.close();
}
