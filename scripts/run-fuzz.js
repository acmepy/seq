import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = require.resolve('@jazzer.js/core/package.json');
const cli = resolve(dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).bin.jazzer);
const args = process.argv.slice(2);
const mode = ['smoke', 'regression', 'replay', 'verify', 'coverage'].includes(args[0]) ? args.shift() : 'fuzzing';
const corpus = resolve(root, '.fuzz/corpus/sql-generator');
const artifacts = resolve(root, '.fuzz/artifacts');
mkdirSync(corpus, { recursive: true });
mkdirSync(artifacts, { recursive: true });
let inputs = [corpus, 'fuzz/corpus/sql-generator'];
if (mode === 'verify') inputs = ['fuzz/corpus/sql-generator'];
if (mode === 'replay') {
  if (!args[0] || args[0].startsWith('-')) throw new Error('Usage: npm run fuzz:replay -- <artifact-file>');
  const artifact = resolve(root, args.shift());
  if (!statSync(artifact).isFile()) throw new Error('Replay input must be a file');
  inputs = [artifact];
}
// SQL-specific assertions are the oracle; OS/network bug detectors are unrelated to this pure target.
const target = process.env.SEQ_FUZZ_MUTATION ? 'fuzz/sql-generator.mutant.js' : 'fuzz/sql-generator.fuzz.js';
const command = [cli, target, ...inputs,
  '--includes=src', '--excludes=node_modules', '--disableBugDetectors=.*'];
if (['regression', 'verify', 'coverage'].includes(mode)) command.push('--mode=regression');
if (mode === 'coverage') command.push('--coverage', '--coverageDirectory', resolve(root, '.fuzz/coverage'), '--coverageReporters=html', '--coverageReporters=json-summary', '--coverageReporters=text-summary');
command.push('--', '-max_len=2048', '-timeout=10', '-artifact_prefix=' + artifacts + sep);
if (mode === 'smoke') command.push('-runs=10000');
command.push(...args);
const child = spawn(process.execPath, command, { cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
