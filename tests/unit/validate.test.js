import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePack } from '../../src/content/validate.js';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
const ASSET_IDS = new Set(manifest.assets.map((a) => a.id));

async function loadSlPack() {
  const raw = await readFile(path.join(root, 'content/sl.json'), 'utf8');
  return JSON.parse(raw);
}

test('the real starter sl.json pack validates cleanly', async () => {
  const pack = await loadSlPack();
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.equal(result.pack.entries.length, 25);
});

test('rejects a syllable_body that does not reproduce body', async () => {
  const pack = await loadSlPack();
  // Insert a letter right after the first syllable boundary — guaranteed to
  // desync the stripped text from body regardless of the entry's content.
  pack.entries[0].syllable_body = pack.entries[0].syllable_body.replace('|', '|x');
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

test('accepts a valid neutral_body/neutral_syllable_body pair and carries it through to the entry', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body = 'Zgodba o {name} in zmaju.';
  pack.entries[0].neutral_body = 'Zgodba o dečku in zmaju.';
  pack.entries[0].neutral_syllable_body = 'Zgod|ba o deč|ku in zma|ju.';
  delete pack.entries[0].syllable_body;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.equal(result.pack.entries[0].neutral_body, 'Zgodba o dečku in zmaju.');
  assert.equal(result.pack.entries[0].neutral_syllable_body, 'Zgod|ba o deč|ku in zma|ju.');
});

test('rejects a neutral_body that still contains the {name} placeholder', async () => {
  const pack = await loadSlPack();
  pack.entries[0].neutral_body = 'Zgodba o {name}.';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'neutral_body'));
});

test('rejects a neutral_syllable_body that does not reproduce neutral_body', async () => {
  const pack = await loadSlPack();
  pack.entries[0].neutral_body = 'Zgodba o dečku.';
  pack.entries[0].neutral_syllable_body = 'Zgod|ba o deč|ku|u.';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SYLLABLE_MISMATCH' && e.field === 'neutral_syllable_body'));
});

test('accepts valid sentences that join with single spaces to reproduce body', async () => {
  const pack = await loadSlPack();
  // A single-element array trivially reproduces body when joined, regardless
  // of the entry's actual content — keeps this test independent of fixtures.
  pack.entries[0].sentences = [pack.entries[0].body];
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.pack.entries[0].sentences, pack.entries[0].sentences);
});

test('rejects sentences that do not reproduce body when joined', async () => {
  const pack = await loadSlPack();
  pack.entries[0].sentences = ['This does not match the body at all.'];
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SENTENCES_MISMATCH'));
});
