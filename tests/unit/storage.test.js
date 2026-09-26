import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStorageCapability,
  listPresets,
  savePreset,
  deletePreset,
  exportPresetsToBlob,
  importPresetsFromJson,
  resetAllData
} from '../../src/storage.js';
import { readFileSync } from 'node:fs';
import { buildWorksheet } from '../../src/worksheet/build.js';

/** Minimal in-memory localStorage-shaped mock, so tests never touch a real browser's storage. */
function createMockStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

/** A storage backend whose writes always throw, simulating a full/blocked quota. */
function createFailingStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {}
  };
}

// A full, validatePresetSettings-passing settings object — importPresetsFromJson
// validates each incoming preset (workstream D2), so fixtures used to
// exercise the import path must be genuinely valid, not just shaped.
const SETTINGS = {
  language: 'sl',
  theme: 'stories',
  level: 1,
  fontId: 'andika',
  fontSizePt: 16,
  lineHeightMultiplier: 1.4,
  letterSpacingPt: 0.3,
  extraWordSpacePt: 1,
  writingMode: 'read-copy',
  rulingId: 'standard-3line',
  guideHeightMm: 10,
  letterColors: {},
  syllableMode: 'off',
  header: { nameLine: true, date: true, title: true },
  marginMm: 20
};

test('checkStorageCapability returns true for a working backend', () => {
  assert.equal(checkStorageCapability(createMockStorage()), true);
});

test('checkStorageCapability returns false, not a throw, for a failing backend', () => {
  assert.equal(checkStorageCapability(createFailingStorage()), false);
});

test('listPresets returns an empty array when storage is unavailable', () => {
  assert.deepEqual(listPresets(createFailingStorage()), []);
});

test('listPresets returns an empty array (not a throw) for corrupted stored JSON', () => {
  const storage = createMockStorage();
  storage.setItem('worksheet-presets-v1', 'not valid json{{{');
  assert.deepEqual(listPresets(storage), []);
});

test('savePreset then listPresets round-trips the same settings', () => {
  const storage = createMockStorage();
  const result = savePreset('Moj nastavitve', SETTINGS, storage);
  assert.equal(result.ok, true);
  const presets = listPresets(storage);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, 'Moj nastavitve');
  assert.deepEqual(presets[0].settings, SETTINGS);
});

test('savePreset with an existing name overwrites rather than duplicating', () => {
  const storage = createMockStorage();
  savePreset('Ime', { ...SETTINGS, level: 1 }, storage);
  savePreset('Ime', { ...SETTINGS, level: 3 }, storage);
  const presets = listPresets(storage);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].settings.level, 3);
});

test('savePreset reports failure (not a false success) when storage cannot actually write', () => {
  const result = savePreset('Ime', SETTINGS, createFailingStorage());
  assert.equal(result.ok, false);
});

test('savePreset rejects invalid settings instead of writing them unchecked', () => {
  const storage = createMockStorage();
  const result = savePreset('Ime', { ...SETTINGS, rulingId: 'does-not-exist' }, storage);
  assert.equal(result.ok, false);
  assert.deepEqual(listPresets(storage), []);
});

test('deletePreset removes only the targeted preset', () => {
  const storage = createMockStorage();
  const a = savePreset('A', SETTINGS, storage).preset;
  savePreset('B', SETTINGS, storage);
  deletePreset(a.id, storage);
  const names = listPresets(storage).map((p) => p.name);
  assert.deepEqual(names, ['B']);
});

test('exportPresetsToBlob then importPresetsFromJson round-trips into a second store', async () => {
  const sourceStorage = createMockStorage();
  savePreset('Prva', SETTINGS, sourceStorage);
  savePreset('Druga', { ...SETTINGS, level: 4 }, sourceStorage);

  const blob = exportPresetsToBlob(sourceStorage);
  const text = await blob.text();

  const targetStorage = createMockStorage();
  const importResult = importPresetsFromJson(text, targetStorage);
  assert.equal(importResult.ok, true);
  assert.equal(importResult.imported, 2);
  assert.deepEqual(importResult.skipped, []);
  assert.equal(listPresets(targetStorage).length, 2);
});

test('importPresetsFromJson skips a preset with invalid settings instead of importing it unchecked', () => {
  const storage = createMockStorage();
  const importResult = importPresetsFromJson(
    JSON.stringify({
      schemaVersion: 1,
      presets: [
        { id: 'good', name: 'Good', settings: SETTINGS },
        { id: 'bad', name: 'Bad (unknown rulingId)', settings: { ...SETTINGS, rulingId: 'does-not-exist' } }
      ]
    }),
    storage
  );
  assert.equal(importResult.ok, true);
  assert.equal(importResult.imported, 1);
  assert.equal(importResult.skipped.length, 1);
  assert.equal(importResult.skipped[0].name, 'Bad (unknown rulingId)');
  assert.ok(importResult.skipped[0].errors.some((e) => e.field === 'rulingId'));
  const presets = listPresets(storage);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, 'Good');
});

test('importPresetsFromJson rejects invalid JSON without throwing', () => {
  const result = importPresetsFromJson('{{{not json', createMockStorage());
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_JSON');
});

test('importPresetsFromJson rejects an unsupported schema version', () => {
  const result = importPresetsFromJson(JSON.stringify({ schemaVersion: 99, presets: [] }), createMockStorage());
  assert.equal(result.ok, false);
  assert.equal(result.error, 'UNSUPPORTED_SCHEMA');
});

test('importPresetsFromJson assigns a fresh id instead of silently overwriting on collision', () => {
  const storage = createMockStorage();
  const existing = savePreset('Obstoječa', SETTINGS, storage).preset;
  const importResult = importPresetsFromJson(
    JSON.stringify({ schemaVersion: 1, presets: [{ id: existing.id, name: 'Uvožena', settings: SETTINGS }] }),
    storage
  );
  assert.equal(importResult.ok, true);
  const presets = listPresets(storage);
  assert.equal(presets.length, 2);
  const ids = new Set(presets.map((p) => p.id));
  assert.equal(ids.size, 2, 'imported preset must not collide with the existing id');
});

test('resetAllData clears presets, and the legacy favorites key from pre-0.8 installs, but nothing else in the same storage', () => {
  const storage = createMockStorage();
  savePreset('Ime', SETTINGS, storage);
  // Favorites were removed in 0.8; seed the old key directly to simulate a
  // browser profile left over from a 0.7 install and confirm reset still
  // cleans it up.
  storage.setItem('worksheet-favorites-v1', JSON.stringify([{ language: 'sl', contentId: 'stories_muc_1' }]));
  storage.setItem('some-unrelated-app-key', 'keep me');

  const ok = resetAllData(storage);
  assert.equal(ok, true);
  assert.deepEqual(listPresets(storage), []);
  assert.equal(storage.getItem('worksheet-favorites-v1'), null);
  assert.equal(storage.getItem('some-unrelated-app-key'), 'keep me');
});

test('resetAllData reports failure (not a false success) when storage is unavailable', () => {
  assert.equal(resetAllData(createFailingStorage()), false);
});

// Compatibility promise: a setup exported by 0.9 (fields exactly as 0.9's
// extractPresetSettings wrote them) keeps loading as settings are added.
test('a preset file exported by 0.9 still imports, and builds with every newer setting at its default', () => {
  const storage = createMockStorage();
  const json = readFileSync(new URL('../fixtures/presets-0.9.json', import.meta.url), 'utf8');
  assert.deepEqual(importPresetsFromJson(json, storage), { ok: true, imported: 1, skipped: [] });
  const [preset] = listPresets(storage);
  assert.equal(preset.settings.lineNumbers, undefined);
  const entry = { id: 't', version: 1, theme: 'stories', level: 2, title: 'Naslov', body: 'Maja ima muco.', imageId: 'img', language: 'sl' };
  const assets = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
  const model = buildWorksheet(entry, preset.settings, assets, 'sl');
  assert.equal(model.blocks.find((b) => b.type === 'passage').lineNumbers, false);
});
