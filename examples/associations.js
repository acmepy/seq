import { Seq, Model, DataTypes, SQLiteAdapter } from '../src/index.js';

class User extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { seq, modelName: 'User', timestamps: true }
    );
  }
}

class Task extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(100), allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: false }
      },
      { seq, modelName: 'Task', timestamps: true }
    );
  }
}

class Profile extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        bio: { type: DataTypes.STRING(200) },
        userId: { type: DataTypes.INTEGER, allowNull: false, unique: true }
      },
      { seq, modelName: 'Profile', timestamps: true }
    );
  }
}

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

const ana = await User.create({ name: 'Ana' });
const juan = await User.create({ name: 'Juan' });

await Task.bulkCreate([
  { title: 'Design FK system', userId: ana.getDataValue('id') },
  { title: 'Write tests', userId: ana.getDataValue('id') },
  { title: 'Update docs', userId: juan.getDataValue('id') }
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
const taskSchema = seq._adapter.schemas.get('task');
if (taskSchema) {
  console.log('  task.foreignKeys:', JSON.stringify(taskSchema.foreignKeys, null, 2));
} else {
  console.log('  task schema not found');
}

await seq.close();
await adapter.close();
