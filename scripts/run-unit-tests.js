import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'tests');
const excludedTests = new Set(['mysql-adapter.test.js', 'oracle-adapter.test.js']);
const testFiles = (await readdir(testsDirectory))
  .filter(file => file.endsWith('.test.js') && !excludedTests.has(file))
  .map(file => join(testsDirectory, file));

const child = spawn(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
