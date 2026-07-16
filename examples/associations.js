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

await seq.init();
await seq.sync();

const ana = await User.create({ name: 'Ana', email: 'ana@example.com' });
const juan = await User.create({ name: 'Juan', email: 'juan@example.com' });

await Task.bulkCreate([
  { title: 'Design FK system', userId: ana.getDataValue('id'), completed: true },
  { title: 'Write tests', userId: ana.getDataValue('id'), completed: false },
  { title: 'Update docs', userId: juan.getDataValue('id'), completed: true }
]);

await Profile.create({ bio: 'Full-stack developer', userId: ana.getDataValue('id') });

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

await seq.close();
await adapter.close();
