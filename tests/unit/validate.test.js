import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePack } from '../../src/content/validate.js';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const ASSET_IDS = new Set(['blue_kite', 'kite_yellow_field']);

async function loadSlPack() {
  const raw = await readFile(path.join(root, 'content/sl.json'), 'utf8');
  return JSON.parse(raw);
}

test('the real starter sl.json pack validates cleanly', async () => {
  const pack = await loadSlPack();
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.equal(result.pack.entries.length, 2);
});

test('rejects a syllable_body that does not reproduce body', async () => {
  const pack = await loadSlPack();
  pack.entries[0].syllable_body = pack.entries[0].syllable_body.replace('Ma|ja', 'Ma|jaa');
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SYLLABLE_MISMATCH'));
});

test('rejects a duplicate entry id within one pack', async () => {
  const pack = await loadSlPack();
  pack.entries[1].id = pack.entries[0].id;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_ID'));
});

test('rejects an imageId with no matching asset', async () => {
  const pack = await loadSlPack();
  pack.entries[0].imageId = 'does_not_exist';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_IMAGE'));
});

test('rejects an out-of-range level', async () => {
  const pack = await loadSlPack();
  pack.entries[0].level = 6;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'level'));
});

test('rejects an unknown placeholder in body', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body += ' {unknown}';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'UNKNOWN_PLACEHOLDER'));
});

test('rejects an unsupported schemaVersion', async () => {
  const pack = await loadSlPack();
  pack.schemaVersion = 2;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'UNSUPPORTED_SCHEMA'));
});

test('a failing entry does not throw — it returns structured errors', async () => {
  const pack = await loadSlPack();
  pack.entries.push({ id: '', level: 99 });
  assert.doesNotThrow(() => validatePack(pack, ASSET_IDS));
});
