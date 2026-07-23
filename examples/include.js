import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';
import { Task } from './models/Task.js';
import { Profile } from './models/Profile.js';

User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Profile, { foreignKey: 'userId', onDelete: 'CASCADE' });
Profile.belongsTo(User, { foreignKey: 'userId' });

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Task, Profile],
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

console.log('\n--- SQL aliases ---');
console.log(`  User.alias = "${User.alias}"`);
console.log(`  Task.alias = "${Task.alias}"`);
console.log(`  Profile.alias = "${Profile.alias}"`);
console.log(`  User.hasMany(Task).as = "${User.associations['Task'].as}"`);
console.log(`  Task.belongsTo(User).as = "${Task.associations['User'].as}"`);

console.log('\n--- Include: users with tasks (hasMany) ---');
const usersWithTasks = await User.findAll({ include: Task });
for (const u of usersWithTasks) {
  const tasks = u.getDataValue('tasks');
  console.log(`  ${u.getDataValue('name')}: ${tasks.length} tasks`);
  for (const t of tasks) {
    console.log(`    - "${t.getDataValue('title')}"`);
  }
}

console.log('\n--- Include: users with profile (hasOne) ---');
const usersWithProfile = await User.findAll({ include: Profile });
for (const u of usersWithProfile) {
  const profile = u.getDataValue('profile');
  console.log(`  ${u.getDataValue('name')}: ${profile ? profile.getDataValue('bio') : 'no profile'}`);
}

console.log('\n--- Include: tasks with user (belongsTo) ---');
const tasksWithUser = await Task.findAll({ include: User });
for (const t of tasksWithUser) {
  const user = t.getDataValue('user');
  console.log(`  "${t.getDataValue('title')}" by ${user.getDataValue('name')}`);
}

console.log('\n--- Include: multiple associations ---');
const usersMulti = await User.findAll({ include: [Task, Profile] });
for (const u of usersMulti) {
  console.log(`  ${u.getDataValue('name')}:`);
  console.log(`    tasks: ${u.getDataValue('tasks').length}`);
  console.log(`    profile: ${u.getDataValue('profile') ? 'yes' : 'no'}`);
}

console.log('\n--- Include with where: only completed tasks ---');
const usersCompleted = await User.findAll({
  include: [{ model: Task, where: { completed: true } }]
});
for (const u of usersCompleted) {
  const tasks = u.getDataValue('tasks');
  console.log(`  ${u.getDataValue('name')}: ${tasks.length} completed tasks`);
}

console.log('\n--- Eager include (LEFT JOIN, 1 query) ---');
const usersEager = await User.findAll({ include: Task, eager: true });
for (const u of usersEager) {
  const tasks = u.getDataValue('tasks');
  console.log(`  ${u.getDataValue('name')}: ${tasks.length} tasks (JOIN)`);
}

console.log('\n--- Mixed: global eager, profile lazy ---');
const usersMixed = await User.findAll({
  include: [Task, { model: Profile, eager: false }],
  eager: true
});
for (const u of usersMixed) {
  console.log(`  ${u.getDataValue('name')}: tasks=${u.getDataValue('tasks').length}, profile=${u.getDataValue('profile') ? 'yes' : 'no'}`);
}

console.log('\n--- Global lazy, profile eager ---');
const usersMixed2 = await User.findAll({
  include: [Task, { model: Profile, eager: true }]
});
for (const u of usersMixed2) {
  console.log(`  ${u.getDataValue('name')}: tasks=${u.getDataValue('tasks').length}, profile=${u.getDataValue('profile') ? 'yes' : 'no'}`);
}

await seq.close();
