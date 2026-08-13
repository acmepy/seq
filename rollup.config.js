const input = 'src/index.js';
const external = ['better-sqlite3', 'crypto'];

export default {
  input,
  external,
  output: {
    file: 'dist/yep.js',
    format: 'es',
    sourcemap: true
  }
};
