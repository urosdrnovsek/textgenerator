#!/usr/bin/env node
/**
 * Produces the release/ directory: a classic-script bundle plus the static
 * assets it references by relative path, so the whole folder opens
 * correctly via a plain file:// double-click (blueprint section 4, "A").
 */

import { build } from 'esbuild';
import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateAllContent } from './validate-content.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(root, 'release');
const generatedDir = path.join(root, 'src/generated');

const MIME_EXT = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/**
 * Bundling 100+ images as one `import x from '...jpg'` per file doesn't
 * scale and is easy to silently miss when adding new content. Instead,
 * pre-render every image/* manifest asset into one JSON file of
 * `id -> data: URL`, generated fresh on every build so it can never drift
 * from assets/manifest.json.
 */
async function generateImageData() {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  const data = {};
  for (const asset of manifest.assets) {
    const ext = MIME_EXT[asset.mime];
    if (!ext) continue; // fonts and other non-image assets are copied as files, not inlined
    const bytes = await readFile(path.join(root, asset.path));
    data[asset.id] = `data:${asset.mime};base64,${bytes.toString('base64')}`;
  }
  await mkdir(generatedDir, { recursive: true });
  await writeFile(path.join(generatedDir, 'imageData.json'), JSON.stringify(data));
  return Object.keys(data).length;
}

async function main() {
  const contentCheck = await validateAllContent();
  if (!contentCheck.ok) {
    console.error(`Refusing to build: content validation failed (${contentCheck.errors.length} error(s)):`);
    for (const e of contentCheck.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const imageCount = await generateImageData();
  console.log(`Generated src/generated/imageData.json (${imageCount} images).`);

  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true,
    outfile: path.join(releaseDir, 'app.js'),
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox110'],
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
