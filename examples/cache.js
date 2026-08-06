import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';
import { Product } from './models/Product.js';
import { Role } from './models/Role.js';
import { UserRole } from './models/UserRole.js';

// Associations
User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', otherKey: 'roleId' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId', otherKey: 'userId' });

// Setup database in memory
const adapter = new SQLiteAdapter({ database: ':memory:' });

// Create seq instance with cache configured
const seq = new Seq({
  adapter,
  models: [User, Product, Role, UserRole],
  cache: {
    ttl: 30000, // Global TTL: 30 seconds
    User: {
      ttl: 60000 // Users specific TTL: 60 seconds
    },
    Role: {
      ttl: 15000 // Roles TTL: 15 seconds
    },
    Product: false // Disable caching for the Product model
  },
  logging: {
    // Enable trace logging to see cache hits and misses in the console
    trace: console.log,
    info: false,
    warn: console.warn,
    error: console.error
  }
});

// Initialize and sync schema
await seq.authenticate();
await seq.sync();

// Create sample data (This will automatically invalidate the users cache)
console.log('--- Creating Users (mutations invalidate cache) ---');
await User.bulkCreate([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
]);

console.log('\n--- First Read (Cache Miss) ---');
// The first read will result in a cache miss and populate the cache
const usersFirstRead = await User.findAll();
console.log(`Found ${usersFirstRead.length} users`);

console.log('\n--- Second Read (Cache Hit) ---');
// The second read with the same parameters will result in a cache hit
const usersSecondRead = await User.findAll();
console.log(`Found ${usersSecondRead.length} users`);

console.log('\n--- Bypass Cache ---');
// Passing cache: false ignores the cache
await User.findAll({ cache: false });

console.log('\n--- Mutating Data (Invalidates Cache) ---');
// Updating a record will automatically invalidate the cache for that model
await User.update({ balance: 50 }, { where: { name: 'Alice' } });

console.log('\n--- Read After Mutation (Cache Miss) ---');
// Since it was invalidated, the next read is a cache miss
await User.findAll();

console.log('\n--- Disabled Model Caching (Product) ---');
// Create a product
await Product.create({ productName: 'Laptop', unitPrice: 1000 });

// Products have cache: false in the seq configuration
await Product.findAll(); // No cache trace
await Product.findAll(); // No cache trace

console.log('\n--- Transactions Bypass Cache ---');
await seq.transaction(async (t) => {
  // Reads inside transactions bypass the cache to ensure fresh data
  await User.findAll({ transaction: t });
  
  // Mutations inside transactions wait until commit to invalidate the cache
  await User.create({ name: 'Charlie', email: 'charlie@example.com' }, { transaction: t });
  
  console.log('Inside transaction: mutations executed, waiting for commit...');
});
console.log('Transaction committed! Cache invalidated via afterCommit hook.');

// After commit, the cache is invalidated
console.log('\n--- Read After Transaction (Cache Miss) ---');
await User.findAll();

// Belongs-to-many example (simplified)
// Create a role
const adminRole = await Role.create({ name: 'Admin' });
// Find user Charlie
const userCharlie = await User.findOne({ where: { name: 'Charlie' } });
// Manually associate via join table using the through model
await UserRole.create({ userId: userCharlie.getDataValue('id'), roleId: adminRole.getDataValue('id') });
console.log('Associated admin role to Charlie via UserRole model');
console.log('\n--- First Belongs-To-Many Read (Cache Miss) ---');
const usersWithRolesFirst = await User.findAll({ include: [Role] });
console.log(`Loaded ${usersWithRolesFirst.length} users with roles.`);

console.log('\n--- Second Belongs-To-Many Read (Cache Hit) ---');
const usersWithRolesSecond = await User.findAll({ include: [Role] });
console.log(`Loaded ${usersWithRolesSecond.length} users with roles.`);

console.log('\n--- Eager Belongs-To-Many Read (Cache Miss) ---');
const usersWithRolesEager = await User.findAll({ include: [Role], eager: true });
console.log(`Loaded ${usersWithRolesEager.length} users with roles eager.`);

console.log('--- Eager Belongs-To-Many Read (Cache Hit) ---');
const usersWithRolesEagerSecond = await User.findAll({ include: [Role], eager: true });
console.log(`Loaded ${usersWithRolesEagerSecond.length} users with roles eager.`);
await seq.close();
