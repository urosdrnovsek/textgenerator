/**
 * What the app keeps in this browser: saved setups (with their backup file)
 * and the teacher's own texts. Storage may be unavailable, which some
 * browsers do for pages opened from a file, so every write is checked, and a
 * failed save never claims success.
 *
 * Every function takes an injectable storage backend (an object with
 * getItem/setItem/removeItem, i.e. the same interface as `localStorage`),
 * defaulting to the real one — the same rng-injection pattern catalog.js
 * uses, so tests never depend on a real browser's localStorage.
 */

import { isOwnText } from './content/ownText.js';
import { validatePresetSettings } from './worksheet/validateSettings.js';

const STORAGE_KEY = 'worksheet-presets-v1';
/** A key of the removed Favorites feature (before 0.8): reset still clears it. */
const FAVORITES_STORAGE_KEY = 'worksheet-favorites-v1';
const CAPABILITY_TEST_KEY = 'worksheet-storage-check';
const OWN_TEXTS_STORAGE_KEY = 'worksheet-own-texts-v1';
/** Every key the app writes: "Reset saved data" clears exactly these, nothing else in the browser. */
const ALL_APP_KEYS = [STORAGE_KEY, FAVORITES_STORAGE_KEY, OWN_TEXTS_STORAGE_KEY];

/** Date.now() alone collides when two presets are saved within the same millisecond. */
function generatePresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {number} schemaVersion
 * @property {string} name
 * @property {{ language: string, theme: string, level: number } & import('./worksheet/build.js').WorksheetSettings} settings
 * @property {boolean} [builtin] the two built-in setups (ui/presets.js); never stored
 */

function defaultStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/**
 * @param {Storage} [storage]
 * @returns {storage is Storage}
 */
export function checkStorageCapability(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(CAPABILITY_TEST_KEY, '1');
    const ok = storage.getItem(CAPABILITY_TEST_KEY) === '1';
    storage.removeItem(CAPABILITY_TEST_KEY);
    return ok;
  } catch {
    return false;
  }
}

/**
 * @param {Storage} [storage]
 * @returns {Preset[]} empty array if storage is unavailable or empty — never throws
 */
export function listPresets(storage = defaultStorage()) {
  if (!checkStorageCapability(storage)) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Preset[]} presets
 * @param {Storage | undefined} storage
 * @returns {boolean} true if the write actually succeeded
 */
function writePresets(presets, storage) {
  if (!checkStorageCapability(storage)) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a setup, or replaces the one of the same name. The settings are
 * validated here too, as on import, whoever the caller.
 * @param {string} name
 * @param {Preset['settings']} settings
 * @param {Storage} [storage]
 * @returns {{ ok: true, preset: Preset } | { ok: false }}
 */
export function savePreset(name, settings, storage = defaultStorage()) {
  if (!validatePresetSettings(settings).ok) return { ok: false };
  const presets = listPresets(storage);
  const existingIndex = presets.findIndex((p) => p.name === name);
  /** @type {Preset} */
  const preset = {
    id: existingIndex >= 0 ? presets[existingIndex].id : generatePresetId(),
    schemaVersion: 1,
    name,
    settings
  };
  const next = existingIndex >= 0
    ? presets.map((p, i) => (i === existingIndex ? preset : p))
    : [...presets, preset];
  const ok = writePresets(next, storage);
  return ok ? { ok: true, preset } : { ok: false };
}

/**
 * @param {string} id
 * @param {Storage} [storage]
 * @returns {boolean} true if the write actually succeeded
 */
export function deletePreset(id, storage = defaultStorage()) {
  const presets = listPresets(storage);
  return writePresets(presets.filter((p) => p.id !== id), storage);
}

/**
 * @param {Storage} [storage]
 * @returns {Blob} a portable JSON backup of every saved preset
 */
export function exportPresetsToBlob(storage = defaultStorage()) {
  return new Blob([JSON.stringify({ schemaVersion: 1, presets: listPresets(storage) }, null, 2)], {
    type: 'application/json'
  });
}

/**
 * @typedef {object} SkippedPreset
 * @property {string} name
 * @property {import('./worksheet/validateSettings.js').SettingsValidationError[]} errors
 */

/**
 * @param {string} jsonText
 * @param {Storage} [storage]
 * @returns {{ ok: true, imported: number, skipped: SkippedPreset[] } | { ok: false, error: string }}
 */
export function importPresetsFromJson(jsonText, storage = defaultStorage()) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.presets)) {
    return { ok: false, error: 'UNSUPPORTED_SCHEMA' };
  }
  const existing = listPresets(storage);
  const existingIds = new Set(existing.map((p) => p.id));
  const shapedIncoming = parsed.presets.filter((p) => p && typeof p.name === 'string' && typeof p.id === 'string' && p.settings);

  // A setup that doesn't validate (a damaged file, another version's
  // settings) is skipped and reported, never imported unchecked.
  /** @type {SkippedPreset[]} */
  const skipped = [];
  const valid = [];
  for (const preset of shapedIncoming) {
    const result = validatePresetSettings(preset.settings);
    if (result.ok) valid.push(preset);
    else skipped.push({ name: preset.name, errors: result.errors });
  }

  // Imported presets with a colliding id get a fresh one rather than silently overwriting.
  const deduped = valid.map((p) => (existingIds.has(p.id) ? { ...p, id: generatePresetId() } : p));
  const ok = writePresets([...existing, ...deduped], storage);
  return ok ? { ok: true, imported: deduped.length, skipped } : { ok: false, error: 'STORAGE_UNAVAILABLE' };
}

/**
 * The teacher's own texts, kept in this browser only (never sent
 * anywhere). Malformed stored items are ignored, not trusted.
 * @param {Storage} [storage]
 * @returns {import('./content/ownText.js').OwnText[]} empty when storage is unavailable
 */
export function listOwnTexts(storage = defaultStorage()) {
  if (!checkStorageCapability(storage)) return [];
  try {
    const parsed = JSON.parse(storage.getItem(OWN_TEXTS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isOwnText) : [];
  } catch {
    return [];
  }
}

/**
 * @param {import('./content/ownText.js').OwnText[]} texts
 * @param {Storage} [storage]
 * @returns {boolean} true if the write actually succeeded
 */
export function writeOwnTexts(texts, storage = defaultStorage()) {
  if (!checkStorageCapability(storage)) return false;
  try {
    storage.setItem(OWN_TEXTS_STORAGE_KEY, JSON.stringify(texts));
    return true;
  } catch {
    return false;
  }
}

/**
 * "Reset saved data": deletes the app's own keys and nothing else a shared
 * school computer's browser may hold.
 * @param {Storage} [storage]
 * @returns {boolean} true if every key was actually removed
 */
export function resetAllData(storage = defaultStorage()) {
  if (!checkStorageCapability(storage)) return false;
  try {
    for (const key of ALL_APP_KEYS) storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
