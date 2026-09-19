#!/usr/bin/env node
/**
 * Produces the release/ directory: a classic-script bundle plus the static
 * assets it references by relative path, so the whole folder opens
 * correctly via a plain file:// double-click (blueprint section 4, "A").
 */

import { build } from 'esbuild';
import { mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(root, 'release');

async function main() {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true,
    outfile: path.join(releaseDir, 'app.js'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox110'],
    loader: { '.jpg': 'dataurl', '.json': 'json' },
    logLevel: 'info'
  });

  await cp(path.join(root, 'index.html'), path.join(releaseDir, 'index.html'));
  await cp(path.join(root, 'styles'), path.join(releaseDir, 'styles'), { recursive: true });
  await cp(
    path.join(root, 'assets/fonts/andika'),
    path.join(releaseDir, 'assets/fonts/andika'),
    { recursive: true }
  );

  console.log('\nRelease written to', releaseDir);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
