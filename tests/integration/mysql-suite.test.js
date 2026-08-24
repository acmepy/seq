import 'dotenv/config';

process.env.SEQ_TEST_ADAPTER = 'mysql';

await import('./adapter-mysql.test.js');
await import('../mysql-adapter.test.js');
await import('../data-types.test.js');
await import('../associations.test.js');
await import('../cache.test.js');
await import('../ddl-phases.test.js');
await import('../hardening.test.js');
await import('../hooks.test.js');
await import('../include.test.js');
await import('../logging-levels.test.js');
await import('../model-crud.test.js');
await import('../model-init.test.js');
await import('../naming-conventions.test.js');
await import('../nested-create.test.js');
await import('../nested-update.test.js');
await import('../nested-upsert.test.js');
await import('../operators.test.js');
await import('../operators-logical.test.js');
await import('../sequelize-compat.test.js');
await import('../sync.test.js');
await import('../transactions.test.js');
await import('../unique-constraint.test.js');
await import('../upsert.test.js');
