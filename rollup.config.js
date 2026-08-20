const input = 'src/index.js';
const external = ['better-sqlite3', 'crypto', 'mysql2', 'mysql2/promise', 'node:util', 'oracledb'];

export default {
  input,
  external,
  output: {
    file: 'dist/seq.js',
    format: 'es',
    sourcemap: true
  }
};
