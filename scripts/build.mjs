import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const COPY_DIRECTORIES = ['bin', 'fixtures', 'public', 'scenarios', 'src'];
const COPY_FILES = ['.nvmrc', 'package.json', 'package-lock.json'];
const BROWSER_SCRIPTS = ['public/app.js', 'public/landing.js', 'public/interaction-effects.js'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const directory of COPY_DIRECTORIES) {
  await cp(path.join(ROOT, directory), path.join(DIST, directory), { recursive: true });
}

for (const file of COPY_FILES) {
  await cp(path.join(ROOT, file), path.join(DIST, file));
}

for (const relativePath of BROWSER_SCRIPTS) {
  await execFileAsync(process.execPath, ['--check', path.join(ROOT, relativePath)]);
}

const requiredFiles = [
  'bin/behavior-diff-workbench.mjs',
  'public/index.html',
  'public/lab.html',
  'public/landing.js',
  'public/interaction-effects.js',
  'public/styles.css',
  'public/hand_cursor.png',
  'scenarios/cart-noisy.json',
];

for (const relativePath of requiredFiles) {
  await readFile(path.join(DIST, relativePath));
}

console.log(`Built ${path.relative(ROOT, DIST)}/ with ${COPY_DIRECTORIES.length} source directories.`);
