#!/usr/bin/env node
/**
 * Validates every content pack and the asset manifest before a release is
 * built (blueprint section 12: "Validate the whole content collection
 * during every release build"). Checks: every language in
 * src/languages.js has its content pack and its locale (and nothing else
 * sits in content/ or locales/), schema/entry validity (via
 * src/content/validate.js), duplicate ids *across* packs (validatePack only
 * catches duplicates within one pack), and that every manifest asset's path
 * actually exists on disk — a stale manifest entry is a real-world failure
 * mode a JSON-only check would miss.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validatePack } from '../src/content/validate.js';
import { LANGUAGE_CODES } from '../src/languages.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The language list and the files agree: each registered language has
 * content/<code>.json and locales/<code>.json declaring that language, and
 * no file belongs to a language that isn't registered (it would never be
 * bundled, silently).
 * @returns {Promise<string[]>}
 */
async function checkLanguageFiles() {
  const errors = [];
  for (const dir of ['content', 'locales']) {
    for (const code of LANGUAGE_CODES) {
      const file = `${dir}/${code}.json`;
      try {
        const { language } = JSON.parse(await readFile(path.join(root, file), 'utf8'));
        if (language !== code) errors.push(`${file}: "language" is "${language}", expected "${code}"`);
      } catch (error) {
        errors.push(`${file}: missing or not valid JSON for a language listed in src/languages.js (${error.code ?? error.message})`);
      }
    }
    for (const file of (await readdir(path.join(root, dir))).filter((f) => f.endsWith('.json'))) {
      if (!LANGUAGE_CODES.includes(file.replace(/\.json$/, ''))) {
        errors.push(`${dir}/${file}: no such language in src/languages.js (add it there, or remove the file)`);
      }
    }
  }
  return errors;
}

/**
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function validateAllContent() {
  /** @type {string[]} */
  const errors = [];

  const manifestRaw = await readFile(path.join(root, 'assets/manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);

  if (!Array.isArray(manifest.assets)) {
    errors.push('assets/manifest.json: "assets" must be an array');
    return { ok: false, errors };
  }

  const assetIds = new Set();
  for (const asset of manifest.assets) {
    if (!asset.id || !asset.path) {
      errors.push(`assets/manifest.json: entry missing id or path: ${JSON.stringify(asset)}`);
      continue;
    }
    if (assetIds.has(asset.id)) {
      errors.push(`assets/manifest.json: duplicate asset id "${asset.id}"`);
    }
    assetIds.add(asset.id);
    try {
      await access(path.join(root, asset.path));
    } catch {
      errors.push(`assets/manifest.json: asset "${asset.id}" points to a missing file: ${asset.path}`);
    }
  }

  errors.push(...(await checkLanguageFiles()));

  const contentDir = path.join(root, 'content');
  const contentFiles = LANGUAGE_CODES.map((code) => `${code}.json`);

  const seenIdsAcrossPacks = new Map(); // id -> file it first appeared in

  for (const file of contentFiles) {
    let raw;
    try {
      raw = JSON.parse(await readFile(path.join(contentDir, file), 'utf8'));
    } catch {
      continue; // reported by checkLanguageFiles
    }
    const result = validatePack(raw, assetIds);
    if (!result.ok) {
      for (const e of result.errors) {
        errors.push(`content/${file}: [${e.code}] ${e.entryId}.${e.field}: ${e.message}`);
      }
      continue;
    }
    for (const entry of result.pack.entries) {
      const globalId = `${result.pack.language}/${entry.id}`;
      if (seenIdsAcrossPacks.has(globalId)) {
        errors.push(`content/${file}: id "${entry.id}" duplicates one already seen in ${seenIdsAcrossPacks.get(globalId)}`);
      } else {
        seenIdsAcrossPacks.set(globalId, file);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

async function main() {
  const result = await validateAllContent();
  if (!result.ok) {
    console.error(`Content validation failed (${result.errors.length} error(s)):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log('Content validation passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
