import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack, KNOWN_THEMES } from '../../src/content/validate.js';
import { LANGUAGE_CODES, ASSET_IDS, readPack } from './helpers.js';

// No entry counts here: adding a text must not mean editing a test. What
// must hold instead is that every pack validates, and that every theme and
// level offers a choice (the title picker and "Create text" need two).
test('every bundled pack validates, with at least two texts in every theme and level', () => {
  for (const language of LANGUAGE_CODES) {
    const result = validatePack(readPack(language), ASSET_IDS);
    assert.equal(result.ok, true, `${language}: ${JSON.stringify(result.errors?.slice(0, 3))}`);
    for (const theme of KNOWN_THEMES) {
      for (let level = 1; level <= 5; level++) {
        const count = result.pack.entries.filter((e) => e.theme === theme && e.level === level).length;
        assert.ok(count >= 2, `${language} ${theme} level ${level}: ${count} text(s)`);
      }
    }
  }
});

test('rejects a syllable_body that does not reproduce body', () => {
  const pack = readPack('sl');
  // Insert a letter right after the first syllable boundary — guaranteed to
  // desync the stripped text from body regardless of the entry's content.
  pack.entries[0].syllable_body = pack.entries[0].syllable_body.replace('|', '|x');
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SYLLABLE_MISMATCH'));
});

test('rejects a duplicate entry id within one pack', () => {
  const pack = readPack('sl');
  pack.entries[1].id = pack.entries[0].id;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_ID'));
});

test('rejects an imageId with no matching asset', () => {
  const pack = readPack('sl');
  pack.entries[0].imageId = 'does_not_exist';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_IMAGE'));
});

test('rejects an out-of-range level', () => {
  const pack = readPack('sl');
  pack.entries[0].level = 6;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'level'));
});

test('rejects an unknown placeholder in body', () => {
  const pack = readPack('sl');
  pack.entries[0].body += ' {unknown}';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'UNKNOWN_PLACEHOLDER'));
});

test('rejects an unsupported schemaVersion', () => {
  const pack = readPack('sl');
  pack.schemaVersion = 2;
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'UNSUPPORTED_SCHEMA'));
});

test('a failing entry does not throw — it returns structured errors', () => {
  const pack = readPack('sl');
  pack.entries.push({ id: '', level: 99 });
  assert.doesNotThrow(() => validatePack(pack, ASSET_IDS));
});

test('rejects a body that still contains the retired {name} placeholder', () => {
  const pack = readPack('sl');
  pack.entries[0].body = 'Zgodba o {name} in zmaju.';
  pack.entries[0].syllable_body = 'Zgod|ba o {name} in zma|ju.';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'UNKNOWN_PLACEHOLDER' && e.field === 'body'));
});

test('drops fields from older schemas (name_default, name_default_syllables, neutral_body) instead of carrying them through', () => {
  const pack = readPack('sl');
  const entry = pack.entries[0];
  entry.name_default = 'Tom';
  entry.name_default_syllables = 'Tom';
  entry.neutral_body = 'left over from an older schema';
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  const resultEntry = result.pack.entries.find((e) => e.id === entry.id);
  assert.equal(resultEntry.name_default, undefined);
  assert.equal(resultEntry.name_default_syllables, undefined);
  assert.equal(resultEntry.neutral_body, undefined);
});

test('accepts valid sentences that join with single spaces to reproduce body', () => {
  const pack = readPack('sl');
  // A single-element array trivially reproduces body when joined, regardless
  // of the entry's actual content — keeps this test independent of fixtures.
  pack.entries[0].sentences = [pack.entries[0].body];
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.pack.entries[0].sentences, pack.entries[0].sentences);
});

test('rejects sentences that do not reproduce body when joined', () => {
  const pack = readPack('sl');
  pack.entries[0].sentences = ['This does not match the body at all.'];
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SENTENCES_MISMATCH'));
});

// Optional review provenance (0.8.1, workstream I8). Only `status` is
// required; the rest is validated for type/enum when present.

test('accepts the optional review provenance fields and carries them through', () => {
  const pack = readPack('sl');
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

test('a review with only status stays valid and leaves the provenance fields undefined', () => {
  const pack = readPack('sl');
  pack.entries[0].review = { status: 'draft' };
  const result = validatePack(pack, ASSET_IDS);
  assert.equal(result.ok, true);
  const review = result.pack.entries[0].review;
  assert.equal(review.status, 'draft');
  for (const field of ['reviewer', 'date', 'nativeSpeaker', 'syllablesReviewed', 'imageAccuracy']) {
    assert.equal(review[field], undefined, field);
  }
});

test('rejects malformed review provenance fields, each with its own field name', () => {
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
    const pack = readPack('sl');
    pack.entries[0].review = { status: 'reviewed', [field]: value };
    const result = validatePack(pack, ASSET_IDS);
    assert.equal(result.ok, false, `${field}=${JSON.stringify(value)} should be rejected`);
    assert.ok(
      result.errors.some((e) => e.code === 'INVALID_FIELD' && e.field === `review.${field}`),
      `${field}=${JSON.stringify(value)} should report review.${field}`
    );
  }
});
