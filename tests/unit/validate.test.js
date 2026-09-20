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

test('accepts a valid name_default/name_default_syllables pair and carries it through to the entry', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body = 'Zgodba o {name} in zmaju.';
  pack.entries[0].syllable_body = 'Zgod|ba o {name} in zma|ju.';
  pack.entries[0].name_default = 'Tom';
  pack.entries[0].name_default_syllables = 'Tom';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.equal(result.pack.entries[0].name_default, 'Tom');
  assert.equal(result.pack.entries[0].name_default_syllables, 'Tom');
});

test('rejects a {name} body with no name_default at all', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body = 'Zgodba o {name} in zmaju.';
  pack.entries[0].syllable_body = 'Zgod|ba o {name} in zma|ju.';
  // entries[0] is a real starter entry that already carries its own
  // name_default — remove it so this test actually exercises the "missing"
  // case rather than inheriting a valid default from the fixture.
  delete pack.entries[0].name_default;
  delete pack.entries[0].name_default_syllables;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_NAME_DEFAULT' && e.field === 'name_default'));
});

test('rejects a name_default that contains "|", "{", or "}"', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body = 'Zgodba o {name}.';
  pack.entries[0].syllable_body = 'Zgod|ba o {name}.';
  pack.entries[0].name_default = 'To|m';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'INVALID_NAME_DEFAULT' && e.field === 'name_default'));
});

test('rejects a name_default_syllables that does not reproduce name_default', async () => {
  const pack = await loadSlPack();
  pack.entries[0].body = 'Zgodba o {name}.';
  pack.entries[0].syllable_body = 'Zgod|ba o {name}.';
  pack.entries[0].name_default = 'Mia';
  pack.entries[0].name_default_syllables = 'Mi|a|a';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SYLLABLE_MISMATCH' && e.field === 'name_default_syllables'));
});

test('an entry with no {name} placeholder does not require name_default, and a stray neutral_body field is dropped rather than carried through', async () => {
  const pack = await loadSlPack();
  const entry = pack.entries.find((e) => !e.body.includes('{name}'));
  entry.neutral_body = 'left over from an older schema';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  const resultEntry = result.pack.entries.find((e) => e.id === entry.id);
  assert.equal(resultEntry.name_default, undefined);
  assert.equal(resultEntry.neutral_body, undefined);
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

// Optional review provenance (0.8.1, workstream I8). Only `status` is
// required; the rest is validated for type/enum when present.

test('accepts the optional review provenance fields and carries them through', async () => {
  const pack = await loadSlPack();
  pack.entries[0].review = {
    status: 'reviewed',
    reviewer: 'A. Native',
    date: '2026-09-21',
    nativeSpeaker: true,
    syllablesReviewed: true,
    imageAccuracy: 'verified'
  };
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.pack.entries[0].review, {
    status: 'reviewed',
    reviewer: 'A. Native',
    date: '2026-09-21',
    nativeSpeaker: true,
    syllablesReviewed: true,
    imageAccuracy: 'verified'
  });
});

test('a review with only status stays valid and leaves the provenance fields undefined', async () => {
  const pack = await loadSlPack();
  pack.entries[0].review = { status: 'draft' };
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  const review = result.pack.entries[0].review;
  assert.equal(review.status, 'draft');
  for (const field of ['reviewer', 'date', 'nativeSpeaker', 'syllablesReviewed', 'imageAccuracy']) {
    assert.equal(review[field], undefined, field);
  }
});

test('rejects malformed review provenance fields, each with its own field name', async () => {
  const bad = [
    ['reviewer', ''],
    ['reviewer', 42],
    ['date', '21.09.2026'],
    ['date', 20260921],
    ['nativeSpeaker', 'yes'],
    ['syllablesReviewed', 1],
    ['imageAccuracy', 'checked']
  ];
  for (const [field, value] of bad) {
    const pack = await loadSlPack();
    pack.entries[0].review = { status: 'reviewed', [field]: value };
    const result = validatePack(pack, ASSET_IDS);
    assert.equal(result.ok, false, `${field}=${JSON.stringify(value)} should be rejected`);
    assert.ok(
      result.errors.some((e) => e.code === 'INVALID_FIELD' && e.field === `review.${field}`),
      `${field}=${JSON.stringify(value)} should report review.${field}`
    );
  }
});
