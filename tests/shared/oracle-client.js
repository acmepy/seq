import 'dotenv/config';
import oracledb from 'oracledb';

// Leave Thin mode as the default; opt into the driver's native Thick API.
if (process.env.ORACLE_CLIENT_LIB_DIR) {
  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR });
}
