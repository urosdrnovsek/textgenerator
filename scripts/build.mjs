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
import { LANGUAGE_CODES } from '../src/languages.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(root, 'release');
const generatedDir = path.join(root, 'src/generated');

const MIME_EXT = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/**
 * Bundling 100+ images as one `import x from '...jpg'` per file doesn't
 * scale and is easy to silently miss when adding new content. Instead,
 * pre-render every image/* manifest asset into one JSON file of
 * `id -> { dataUrl, width, height }`, generated fresh on every build so it
 * can never drift from assets/manifest.json. width/height (carried through
 * from the manifest) let the DOCX exporter size the image at its real
 * aspect ratio instead of stretching it into a fixed box (workstream D1).
 */
async function generateImageData() {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  const data = {};
  for (const asset of manifest.assets) {
    const ext = MIME_EXT[asset.mime];
    if (!ext) continue; // fonts and other non-image assets are copied as files, not inlined
    const bytes = await readFile(path.join(root, asset.path));
    data[asset.id] = {
      dataUrl: `data:${asset.mime};base64,${bytes.toString('base64')}`,
      width: asset.width,
      height: asset.height
    };
  }
  await mkdir(generatedDir, { recursive: true });
  await writeFile(path.join(generatedDir, 'imageData.json'), JSON.stringify(data));
  return Object.keys(data).length;
}

/**
 * Every registered language's content pack and locale in one JSON file,
 * `code -> { pack, locale }`, so the app bundles exactly the languages in
 * src/languages.js and a new language needs no new import anywhere.
 * (validateAllContent has already checked that each file exists.)
 */
async function generateLanguageData() {
  const data = {};
  for (const code of LANGUAGE_CODES) {
    data[code] = {
      pack: JSON.parse(await readFile(path.join(root, 'content', `${code}.json`), 'utf8')),
      locale: JSON.parse(await readFile(path.join(root, 'locales', `${code}.json`), 'utf8'))
    };
  }
  await mkdir(generatedDir, { recursive: true });
  await writeFile(path.join(generatedDir, 'languageData.json'), JSON.stringify(data));
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
  await generateLanguageData();
  console.log(`Generated src/generated/languageData.json (${LANGUAGE_CODES.join(', ')}).`);

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
  await cp(path.join(root, 'assets/fonts'), path.join(releaseDir, 'assets/fonts'), { recursive: true });

  console.log('\nRelease written to', releaseDir);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
