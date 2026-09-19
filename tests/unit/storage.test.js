import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStorageCapability,
  listPresets,
  savePreset,
  deletePreset,
  exportPresetsToBlob,
  importPresetsFromJson
} from '../../src/storage.js';

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

const SETTINGS = { theme: 'stories', level: 1, fontId: 'andika', fontSizePt: 16 };

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
  assert.equal(listPresets(targetStorage).length, 2);
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
