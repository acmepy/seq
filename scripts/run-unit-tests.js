import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'tests');
// Backend-specific files run only through their explicit integration suites.
const testFiles = (await readdir(testsDirectory))
  .filter(file => file.endsWith('.test.js') && !/^(mysql|oracle)/.test(file))
  .map(file => join(testsDirectory, file));

const child = spawn(process.execPath, ['--test', ...testFiles], { stdio: 'inherit', env: { ...process.env, SEQ_TEST_ADAPTER: 'sqlite' } });
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
