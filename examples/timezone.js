// Run: node examples/timezone.js mysql   (or oracle11)
import 'dotenv/config';
import assert from 'node:assert/strict';
import { DataTypes, Model, MySQLAdapter, Oracle11Adapter, Seq } from '../src/index.js';

const engine = process.argv[2] || 'mysql';
if (!['mysql', 'oracle11'].includes(engine)) throw new Error('Use mysql or oracle11');
const oracle = engine === 'oracle11';
const timezone = '-03:00';
const adapter = oracle ? new Oracle11Adapter({
  user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING, timezone
}) : new MySQLAdapter({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE, timezone
});
class Clock extends Model {}
Clock.init({ id: { type: DataTypes.INTEGER, primaryKey: true }, happenedAt: { type: DataTypes.DATE } },
  { modelName: 'TimezoneDemo', tableName: 'SEQ_TIMEZONE_DEMO', timestamps: true });
const seq = new Seq({ adapter, models: [Clock], logging: false });
const localDisplay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Etc/GMT+3', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
let created = false;
try {
  await seq.init();
  const definition = seq.buildTableDefinition(Clock);
  if (await adapter.ddl.hasTable(definition.tableName)) throw new Error('The demo table already exists; it will not be overwritten. ' + definition.tableName);
  await seq.sync();
  created = true;
  const expected = new Date('2026-11-10T14:30:00-03:00');
  await Clock.create({ id: 1, happenedAt: expected });
  const record = await Clock.findByPk(1);
  console.log('Resultado de findByPk (Date nativo):', record.toJSON());

  const found = await Clock.findOne({ where: { id: 1 } });
  console.log('Resultado de findOne mostrado en -03:', {
    ...found.toJSON(),
    happenedAt: localDisplay.format(found.getDataValue('happenedAt')),
    createdAt: localDisplay.format(found.getDataValue('createdAt')),
    updatedAt: localDisplay.format(found.getDataValue('updatedAt'))
  });
  const date = record.getDataValue('happenedAt');
  const q = name => adapter._quoteIdentifier(name);
  const table = q(definition.tableName);
  const field = q(definition.attrToColumn.happenedAt);
  const expression = oracle ? "TO_CHAR(" + field + ", 'YYYY-MM-DD HH24:MI:SS')" : "DATE_FORMAT(" + field + ", '%Y-%m-%d %H:%i:%s')";
  const readWallTime = async () => (await adapter.dml.executeGet('SELECT ' + expression + ' AS ' + q('wall_time') + ' FROM ' + table)).wall_time;
  console.log('Motor:', engine, '| Zona configurada:', timezone);
  console.log('Hora guardada en DB:       ', await readWallTime());
  console.log('JavaScript mostrado en -03:', localDisplay.format(date));
  console.log('Mismo instante en UTC:     ', date.toISOString());
  assert.equal(await readWallTime(), '2026-11-10 14:30:00');
  assert.equal(date.getTime(), expected.getTime());
  for (let index = 0; index < 3; index++) await record.save();
  assert.equal(await readWallTime(), '2026-11-10 14:30:00');
  console.log('Tras leer y guardar 3 veces:', await readWallTime());
} finally {
  try { if (created) await adapter.ddl.dropTable(Clock.tableName, { ifExists: true }); }
  finally { await adapter.close(); }
}
