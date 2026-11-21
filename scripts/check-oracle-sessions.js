import '../tests/shared/oracle-client.js';
import assert from 'node:assert/strict';
import oracledb from 'oracledb';

// Read-only reproduction using only the native driver; no SEQ adapter involved.
const options = { user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING, poolMin: 0, poolMax: 1 };
const identitySql = "SELECT SYS_CONTEXT('USERENV', 'SID'), SYS_CONTEXT('USERENV', 'SESSIONID') FROM dual";
let initialized = 0;
const pool = await oracledb.createPool({ ...options, sessionCallback(connection, tag, done) { initialized++; done(); } });
let connection;
let dropResult;
try {
  connection = await pool.getConnection();
  const before = (await connection.execute(identitySql)).rows[0];
  await connection.close({ drop: true });
  connection = null;
  connection = await pool.getConnection();
  const after = (await connection.execute(identitySql)).rows[0];
  dropResult = { samePhysicalSession: JSON.stringify(before) === JSON.stringify(after), initialized, expected: 2 };
} finally {
  if (connection) await connection.close();
  await pool.close(0);
}

let attempts = 0;
const failed = new Error('Intentional initialization failure');
const retryPool = await oracledb.createPool({ ...options,
  sessionCallback(connection, tag, done) { attempts++; done(attempts === 1 ? failed : undefined); } });
connection = null;
try {
  await assert.rejects(() => retryPool.getConnection(), error => error === failed);
  connection = await retryPool.getConnection();
  await connection.execute('SELECT 1 FROM dual');
} finally {
  if (connection) await connection.close();
  await retryPool.close(0);
}
console.log(JSON.stringify({ driver: oracledb.versionString, thin: oracledb.thin, drop: dropResult,
  failedInitialization: { attempts, expected: 2 } }, null, 2));
if (dropResult.samePhysicalSession || initialized !== 2 || attempts !== 2) process.exitCode = 1;
