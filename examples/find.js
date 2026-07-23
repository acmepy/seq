import { Seq, SQLiteAdapter, Op } from '../src/index.js';
import { User } from './models/User.js';
import { Task } from './models/Task.js';
import { fileURLToPath } from 'node:url';

const databasePath = fileURLToPath(new URL('./find.sqlite', import.meta.url));
const adapter = new SQLiteAdapter({ database: databasePath });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Task],
  naming: {
    tables: "snake_case",
    columns: "snake_case",
  },
  logging: {
    info: console.log,
    trace: console.log,
    warn: console.log,
    error: console.log,
  },
});

await seq.authenticate();
//await seq.sync({ force: true });
console.log(`Using SQLite database: ${databasePath}`);

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

// 8. findAndCountAll - total matching rows + current page
const pendingPage = await Task.findAndCountAll({
  where: { completed: false },
  order: [['priority', 'DESC']],
  limit: 2,
  offset: 0
});
printTasks(`findAndCountAll: pending page 1 of ${pendingPage.count} total`, pendingPage.rows);

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

// 11. Op.like — tasks with "docs" in title
const likeTasks = await Task.findAll({ where: { title: { [Op.like]: '%docs%' } } });
printTasks('Op.like: title contains "docs"', likeTasks);

// 12. Op.in — tasks with specific ids
const inTasks = await Task.findAll({ where: { id: { [Op.in]: [1, 3, 5] } } });
printTasks('Op.in: id IN [1, 3, 5]', inTasks);

// 13. Op.between — priority between 1 and 2
const betweenTasks = await Task.findAll({ where: { priority: { [Op.between]: [1, 2] } } });
printTasks('Op.between: priority BETWEEN 1 AND 2', betweenTasks);

// 14. Op.gt — priority greater than 1
const gtTasks = await Task.findAll({ where: { priority: { [Op.gt]: 1 } } });
printTasks('Op.gt: priority > 1', gtTasks);

// 15. Mixed — pending tasks with priority >= 2
const mixedTasks = await Task.findAll({
  where: {
    completed: false,
    priority: { [Op.gte]: 2 }
  }
});
printTasks('Mixed: completed=false AND priority >= 2', mixedTasks);

await seq.close();
