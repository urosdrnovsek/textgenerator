#!/usr/bin/env node
/**
 * Validates every content pack and the asset manifest before a release is
 * built (blueprint section 12: "Validate the whole content collection
 * during every release build"). Checks: schema/entry validity (via
 * src/content/validate.js), duplicate ids *across* packs (validatePack only
 * catches duplicates within one pack), and that every manifest asset's path
 * actually exists on disk — a stale manifest entry is a real-world failure
 * mode a JSON-only check would miss.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validatePack } from '../src/content/validate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

  const contentDir = path.join(root, 'content');
  const contentFiles = (await readdir(contentDir)).filter((f) => f.endsWith('.json'));

  if (contentFiles.length === 0) {
    errors.push('content/: no content pack files found');
  }

  const seenIdsAcrossPacks = new Map(); // id -> file it first appeared in

  for (const file of contentFiles) {
    const raw = JSON.parse(await readFile(path.join(contentDir, file), 'utf8'));
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
