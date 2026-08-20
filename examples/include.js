import { Seq, Model, DataTypes } from '../src/index.js';
import { createExampleAdapter } from './adapter.js';
import { User } from './models/User.js';
import { Task } from './models/Task.js';
import { Profile } from './models/Profile.js';

class Comment extends Model {}
Comment.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    body: { type: DataTypes.STRING(255), allowNull: false },
    public: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    taskId: { type: DataTypes.INTEGER, allowNull: false },
  },
  { modelName: 'Comment', tableName: 'comments', timestamps: false }
);

User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });
Task.hasMany(Comment, { foreignKey: 'taskId', onDelete: 'CASCADE' });
Comment.belongsTo(Task, { foreignKey: 'taskId' });
User.hasOne(Profile, { foreignKey: 'userId', onDelete: 'CASCADE' });
Profile.belongsTo(User, { foreignKey: 'userId' });

const adapter = createExampleAdapter();
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Task, Profile, Comment],
  logging: true
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

await Comment.bulkCreate([
  { body: 'FKs should cascade', taskId: 1, public: true },
  { body: 'Add nested include coverage', taskId: 2, public: true },
  { body: 'Internal implementation note', taskId: 2, public: false },
  { body: 'Docs need an eager example', taskId: 3, public: true }
]);

await Profile.create({ bio: 'Full-stack developer', userId: ana.getDataValue('id') });

const nestedUser = await User.create({
  name: 'Carla',
  email: 'carla@example.com',
  tasks: [
    { title: 'Create parent and children', completed: true },
    { title: 'Review nested create result', completed: false }
  ],
  profile: { bio: 'Nested create example' }
}, {
  include: [Task, Profile]
});

console.log('\n--- Create with include: user, tasks and profile ---');
console.log(`  ${nestedUser.getDataValue('name')}:`);
console.log(`    tasks created: ${nestedUser.getDataValue('tasks').length}`);
console.log(`    profile: ${nestedUser.getDataValue('profile').getDataValue('bio')}`);

console.log('\n--- SQL aliases ---');
console.log(`  User.alias = "${User.alias}"`);
console.log(`  Task.alias = "${Task.alias}"`);
console.log(`  Profile.alias = "${Profile.alias}"`);
console.log(`  Comment.alias = "${Comment.alias}"`);
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

console.log('\n--- Include lazy: users with tasks and profile ---');
const usersWithProfileLazy = await User.findAll({ include: [{ model: Task }, { model: Profile }] });
for (const u of usersWithProfileLazy) {
  console.log(`  ${u.getDataValue('name')}: tasks=${u.getDataValue('tasks').length}, profile=${u.getDataValue('profile')?.getDataValue('bio') || 'none'}`);
}

console.log('\n--- Include eager: users with tasks and profile ---');
const usersWithProfileEager = await User.findAll({ include: [{ model: Task }, { model: Profile }], eager: true });
for (const u of usersWithProfileEager) {
  console.log(`  ${u.getDataValue('name')}: tasks=${u.getDataValue('tasks').length}, profile=${u.getDataValue('profile')?.getDataValue('bio') || 'none'}`);
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

console.log('\n--- Nested include: users with tasks and comments (lazy) ---');
const usersNestedLazy = await User.findAll({
  include: [{
    model: Task,
    include: Comment
  }]
});
for (const u of usersNestedLazy) {
  console.log(`  ${u.getDataValue('name')}:`);
  for (const t of u.getDataValue('tasks')) {
    console.log(`    - "${t.getDataValue('title')}": ${t.getDataValue('comments').length} comments`);
  }
}

console.log('\n--- Eager include (LEFT JOIN, 1 query) ---');
const usersEager = await User.findAll({ include: Task, eager: true });
for (const u of usersEager) {
  const tasks = u.getDataValue('tasks');
  console.log(`  ${u.getDataValue('name')}: ${tasks.length} tasks (JOIN)`);
}

console.log('\n--- Nested eager include: users with tasks and comments (JOINs) ---');
const usersNestedEager = await User.findAll({
  include: [{
    model: Task,
    include: [{ model: Comment, where: { public: true } }]
  }],
  eager: true
});
for (const u of usersNestedEager) {
  const publicComments = u.getDataValue('tasks')
    .flatMap(t => t.getDataValue('comments'))
    .map(c => c.getDataValue('body'));
  console.log(`  ${u.getDataValue('name')}: ${publicComments.length} public comments (JOINs)`);
}

console.log('\n--- Nested mixed: tasks eager, comments lazy ---');
const usersNestedMixed = await User.findAll({
  include: [{
    model: Task,
    eager: true,
    include: [{ model: Comment, eager: false, attributes: ['body'] }]
  }],
  eager: true
});
for (const u of usersNestedMixed) {
  const comments = u.getDataValue('tasks').flatMap(t => t.getDataValue('comments'));
  console.log(`  ${u.getDataValue('name')}: ${comments.length} comments, first=${comments[0]?.getDataValue('body') || 'none'}`);
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
