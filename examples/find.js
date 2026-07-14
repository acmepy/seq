import { Seq, SQLiteAdapter } from '../src/index.js';
import { User } from './models/User.js';
import { Task } from './models/Task.js';

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Task],
  logging: console.log
});

await seq.init();
await seq.sync();

// --- Seed data ---
const ana = await User.create({ name: 'Ana', email: 'ana@example.com' });
const juan = await User.create({ name: 'Juan', email: 'juan@example.com' });
const luis = await User.create({ name: 'Luis', email: 'luis@example.com' });

await Task.create({ title: 'Buy groceries', priority: 2, completed: false, userId: ana.getDataValue('id') });
await Task.create({ title: 'Clean house', priority: 0, completed: true, userId: ana.getDataValue('id') });
await Task.create({ title: 'Write docs', priority: 1, completed: false, userId: juan.getDataValue('id') });
await Task.create({ title: 'Run tests', priority: 3, completed: false, userId: juan.getDataValue('id') });
await Task.create({ title: 'Deploy app', priority: 1, completed: true, userId: luis.getDataValue('id') });

const printTasks = (label, tasks) => {
  console.log(`\n--- ${label} ---`);
  tasks.forEach(t => {
    console.log(`  Task ${t.getDataValue('id')}: ${t.getDataValue('title')} (priority: ${t.getDataValue('priority')}, completed: ${t.getDataValue('completed')})`);
  });
};

// 1. findAll — all records
const allTasks = await Task.findAll();
printTasks('All tasks', allTasks);

// 2. findAll + where — filter by completed
const pending = await Task.findAll({ where: { completed: false } });
printTasks('Where: completed = false', pending);

// 3. findAll + order ASC — by priority
const ascPriority = await Task.findAll({ order: [['priority', 'ASC']] });
printTasks('Order ASC by priority', ascPriority);

// 4. findAll + order DESC — by priority
const descPriority = await Task.findAll({ order: [['priority', 'DESC']] });
printTasks('Order DESC by priority', descPriority);

// 5. findAll + limit — first 2
const limited = await Task.findAll({ limit: 2 });
printTasks('Limit 2', limited);

// 6. findAll + offset — skip first 2
const offset = await Task.findAll({ offset: 2 });
printTasks('Offset 2 (skip first 2)', offset);

// 7. findAll + limit + offset — page 2, size 2
const page2 = await Task.findAll({ limit: 2, offset: 2 });
printTasks('Pagination: page 2, size 2', page2);

// 8. findAll + where + order + limit — pending tasks, priority desc, top 2
const topPending = await Task.findAll({
  where: { completed: false },
  order: [['priority', 'DESC']],
  limit: 2
});
printTasks('Pending, order DESC, limit 2', topPending);

// 9. findOne + where
const one = await Task.findOne({ where: { title: 'Clean house' } });
console.log(`\n--- findOne: title = 'Clean house' ---`);
console.log(`  Found: ${one ? one.getDataValue('title') : 'null'}`);

// 10. findByPk
const byPk = await Task.findByPk(1);
console.log(`\n--- findByPk: id = 1 ---`);
console.log(`  Found: ${byPk ? byPk.getDataValue('title') : 'null'}`);

await seq.close();
await adapter.close();
