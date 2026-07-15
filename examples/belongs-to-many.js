import { Seq, Model, DataTypes, SQLiteAdapter } from '../src/index.js';

class User extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false }
      },
      { seq, modelName: 'User', timestamps: false }
    );
  }
}

class Role extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(50), allowNull: false }
      },
      { seq, modelName: 'Role', timestamps: false }
    );
  }
}

class Permission extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(50), allowNull: false }
      },
      { seq, modelName: 'Permission', timestamps: false }
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
      { seq, modelName: 'Task', timestamps: false }
    );
  }
}

User.hasMany(Task, { foreignKey: 'userId' });
Task.belongsTo(User, { foreignKey: 'userId' });
User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'userId', otherKey: 'roleId' });
Role.belongsToMany(User, { through: 'user_roles', foreignKey: 'roleId', otherKey: 'userId' });
Role.belongsToMany(Permission, { through: 'role_permissions', foreignKey: 'roleId', otherKey: 'permissionId' });
Permission.belongsToMany(Role, { through: 'role_permissions', foreignKey: 'permissionId', otherKey: 'roleId' });

const adapter = new SQLiteAdapter({ database: ':memory:' });
await adapter.connect();

const seq = new Seq({
  adapter,
  models: [User, Role, Permission, Task],
  logging: console.log
});

await seq.init();
const syncResult = await seq.sync();
console.log('\n--- Sync result ---');
console.log('  Created:', syncResult.created);

const ana = await User.create({ name: 'Ana' });
const juan = await User.create({ name: 'Juan' });

const admin = await Role.create({ name: 'admin' });
const editor = await Role.create({ name: 'editor' });

const read = await Permission.create({ name: 'read' });
const write = await Permission.create({ name: 'write' });
const deletePerm = await Permission.create({ name: 'delete' });

await Task.bulkCreate([
  { title: 'Review access matrix', userId: ana.getDataValue('id') },
  { title: 'Publish role guide', userId: ana.getDataValue('id') },
  { title: 'Audit permissions', userId: juan.getDataValue('id') }
]);

const dml = adapter.dml;
const execSQL = (sql, params) => dml._executeRun(sql, params);

await execSQL('INSERT INTO "user_roles" ("userId", "roleId") VALUES (?, ?)', [ana.getDataValue('id'), admin.getDataValue('id')]);
await execSQL('INSERT INTO "user_roles" ("userId", "roleId") VALUES (?, ?)', [ana.getDataValue('id'), editor.getDataValue('id')]);
await execSQL('INSERT INTO "user_roles" ("userId", "roleId") VALUES (?, ?)', [juan.getDataValue('id'), admin.getDataValue('id')]);

await execSQL('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES (?, ?)', [admin.getDataValue('id'), read.getDataValue('id')]);
await execSQL('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES (?, ?)', [admin.getDataValue('id'), write.getDataValue('id')]);
await execSQL('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES (?, ?)', [admin.getDataValue('id'), deletePerm.getDataValue('id')]);
await execSQL('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES (?, ?)', [editor.getDataValue('id'), read.getDataValue('id')]);
await execSQL('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES (?, ?)', [editor.getDataValue('id'), write.getDataValue('id')]);

console.log('\n--- Users with Roles (lazy loading) ---');
const users = await User.findAll({ include: Role });
for (const u of users) {
  const roles = u.getDataValue('roles');
  console.log(`  ${u.getDataValue('name')}: ${roles.map(r => r.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Roles with Permissions (lazy loading) ---');
const roles = await Role.findAll({ include: Permission });
for (const r of roles) {
  const perms = r.getDataValue('permissions');
  console.log(`  ${r.getDataValue('name')}: ${perms.map(p => p.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Roles with Permissions and Users (multiple includes) ---');
const rolesWithAll = await Role.findAll({ include: [Permission, User] });
for (const r of rolesWithAll) {
  const perms = r.getDataValue('permissions');
  const usersInRole = r.getDataValue('users');
  console.log(`  ${r.getDataValue('name')}:`);
  console.log(`    permissions: ${perms.map(p => p.getDataValue('name')).join(', ')}`);
  console.log(`    users: ${usersInRole.map(u => u.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Users with Roles (eager loading via JOIN) ---');
const usersEager = await User.findAll({ include: Role, eager: true });
for (const u of usersEager) {
  const roles = u.getDataValue('roles');
  console.log(`  ${u.getDataValue('name')}: ${roles.map(r => r.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Roles with Permissions (eager loading via JOIN) ---');
const rolesEager = await Role.findAll({ include: Permission, eager: true });
for (const r of rolesEager) {
  const perms = r.getDataValue('permissions');
  console.log(`  ${r.getDataValue('name')}: ${perms.map(p => p.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Mixed: eager belongsToMany + lazy hasMany ---');
const usersMixed = await User.findAll({
  include: [
    { model: Role, eager: true },
    { model: Task },
  ],
});
for (const u of usersMixed) {
  const roles = u.getDataValue('roles');
  const tasks = u.getDataValue('tasks');
  console.log(`  ${u.getDataValue('name')}:`);
  console.log(`    roles: ${roles.map(r => r.getDataValue('name')).join(', ')}`);
  console.log(`    tasks: ${tasks.map(t => t.getDataValue('title')).join(', ')}`);
}

console.log('\n--- Eager belongsToMany with where filter ---');
const adminRoles = await Role.findAll({
  include: [{ model: Permission, where: { name: 'read' } }],
  eager: true,
});
for (const r of adminRoles) {
  const perms = r.getDataValue('permissions');
  console.log(`  ${r.getDataValue('name')}: ${perms.map(p => p.getDataValue('name')).join(', ')}`);
}

console.log('\n--- Schema inspection: junction tables ---');
const userRolesSchema = adapter.schemas.get('user_roles');
if (userRolesSchema) {
  console.log('  user_roles columns:', Object.keys(userRolesSchema.columns));
  console.log('  user_roles foreignKeys:', userRolesSchema.foreignKeys.map(fk => fk.constraintName));
}
const rolePermsSchema = adapter.schemas.get('role_permissions');
if (rolePermsSchema) {
  console.log('  role_permissions columns:', Object.keys(rolePermsSchema.columns));
  console.log('  role_permissions foreignKeys:', rolePermsSchema.foreignKeys.map(fk => fk.constraintName));
}

await seq.close();
await adapter.close();
