import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';
import { Task } from './models/Task.js';
import { Profile } from './models/Profile.js';
import { Role } from './models/Role.js';
import { UserRole } from './models/UserRole.js';

User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Profile, { foreignKey: 'userId', onDelete: 'CASCADE' });
Profile.belongsTo(User, { foreignKey: 'userId' });
User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId', otherKey: 'roleId', as: 'roles' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId', otherKey: 'userId', as: 'users' });

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Task, Profile, Role, UserRole],
  naming: { tables: 'snake_case', columns: 'snake_case' },
  logging: console.log
});

await seq.authenticate();
await seq.sync();

const ana = await User.create({ name: 'Ana', email: 'ana@example.com' });
const juan = await User.create({ name: 'Juan', email: 'juan@example.com' });

await Task.bulkCreate([
  { title: 'Design FK system', userId: ana.getDataValue('id'), completed: true },
  { title: 'Write tests', userId: ana.getDataValue('id'), completed: false },
  { title: 'Update docs', userId: juan.getDataValue('id'), completed: true }
]);

await Profile.create({ bio: 'Full-stack developer', userId: ana.getDataValue('id') });

const admin = await Role.create({ name: 'admin' });
const editor = await Role.create({ name: 'editor' });

await UserRole.create({ userId: ana.getDataValue('id'), roleId: admin.getDataValue('id'), assignedBy: 'system' });
await UserRole.create({ userId: ana.getDataValue('id'), roleId: editor.getDataValue('id'), assignedBy: 'system' });
await UserRole.create({ userId: juan.getDataValue('id'), roleId: admin.getDataValue('id'), assignedBy: 'system' });

console.log('\n--- All users ---');
const users = await User.findAll();
for (const u of users) {
  console.log(`  ${u.getDataValue('name')} (id: ${u.getDataValue('id')})`);
}

console.log('\n--- All tasks ---');
const tasks = await Task.findAll();
for (const t of tasks) {
  console.log(`  "${t.getDataValue('title')}" (userId: ${t.getDataValue('userId')})`);
}

console.log('\n--- BelongsToMany through model: users with roles ---');
const usersWithRoles = await User.findAll({ include: { model: Role, as: 'roles' } });
for (const u of usersWithRoles) {
  const roles = u.getDataValue('roles');
  console.log(`  ${u.getDataValue('name')}: ${roles.map(role => role.getDataValue('name')).join(', ')}`);
}

console.log('\n--- FK validation: insert task with invalid userId ---');
try {
  await Task.create({ title: 'Bad task', userId: 999 });
} catch (err) {
  console.log(`  Error: ${err.code} - ${err.message}`);
}

console.log('\n--- Cascade: delete Ana (should cascade-delete tasks and profile) ---');
await ana.destroy();
const remaining = await Task.findAll();
console.log(`  Tasks remaining: ${remaining.length}`);
const profiles = await Profile.findAll();
console.log(`  Profiles remaining: ${profiles.length}`);

console.log('\n--- Schema foreign keys ---');
const taskSchema = seq._adapter.schemas.get('tasks');
if (taskSchema) {
  console.log('  tasks.foreignKeys:', JSON.stringify(taskSchema.foreignKeys, null, 2));
} else {
  console.log('  tasks schema not found');
}

const userRoleSchema = seq._adapter.schemas.get('users_roles');
if (userRoleSchema) {
  console.log('  users_roles columns:', Object.keys(userRoleSchema.columns));
  console.log('  users_roles.foreignKeys:', JSON.stringify(userRoleSchema.foreignKeys, null, 2));
}

await seq.close();
