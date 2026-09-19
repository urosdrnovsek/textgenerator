#!/usr/bin/env node
/**
 * Produces a versioned, distributable ZIP from release/ plus the teacher
 * guide and third-party notices/licenses — the actual thing a school
 * receives (blueprint 4: "Distribute a versioned ZIP by school file
 * share or USB"). Always rebuilds release/ first, so the packaged ZIP can
 * never silently contain stale output.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const zipName = `writing-worksheet-generator-v${version}.zip`;

  console.log('Rebuilding release/ before packaging...');
  execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });

  const distDir = path.join(root, 'dist');
  const stageDir = path.join(distDir, `writing-worksheet-generator-v${version}`);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  await cp(path.join(root, 'release'), stageDir, { recursive: true });
  await cp(path.join(root, 'docs'), path.join(stageDir, 'docs'), { recursive: true });
  await cp(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(stageDir, 'THIRD_PARTY_NOTICES.md'));
  await cp(path.join(root, 'licenses'), path.join(stageDir, 'licenses'), { recursive: true });

  const zipPath = path.join(distDir, zipName);
  await rm(zipPath, { force: true });
  execFileSync('zip', ['-r', '-X', zipName, path.basename(stageDir)], { cwd: distDir, stdio: 'inherit' });

  console.log(`\nPackaged: dist/${zipName}`);
  console.log('Extract it and double-click index.html to run — no install, no server, no internet required.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
