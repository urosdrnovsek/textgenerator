/**
 * Preference storage: capability check, named setup save/load/delete,
 * export/import for portability. localStorage isn't guaranteed to persist
 * under file:// (blueprint section 4, "C") — every write is guarded by a
 * capability check, and a failed save must never claim success.
 *
 * Every function takes an injectable storage backend (an object with
 * getItem/setItem/removeItem, i.e. the same interface as `localStorage`),
 * defaulting to the real one — the same rng-injection pattern catalog.js
 * uses, so tests never depend on a real browser's localStorage.
 */

const STORAGE_KEY = 'worksheet-presets-v1';
const FAVORITES_STORAGE_KEY = 'worksheet-favorites-v1';
const CAPABILITY_TEST_KEY = 'worksheet-storage-check';
/** Every key this application writes to localStorage — resetAllData() must clear exactly these and nothing else (blueprint 13: "deletes only this application's keys, never every key in localStorage"). */
const ALL_APP_KEYS = [STORAGE_KEY, FAVORITES_STORAGE_KEY];

/** Date.now() alone collides when two presets are saved within the same millisecond. */
function generatePresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {number} schemaVersion
 * @property {string} name
 * @property {{ theme: string, level: number } & import('./worksheet/build.js').WorksheetSettings} settings
 */

function defaultStorage() {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/**
 * @param {Storage} [storage]
 * @returns {boolean}
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
 * @param {Storage} storage
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
 * Saves (or overwrites, by name) a named setup.
 * @param {string} name
 * @param {Preset['settings']} settings
 * @param {Storage} [storage]
 * @returns {{ ok: true, preset: Preset } | { ok: false }}
 */
export function savePreset(name, settings, storage = defaultStorage()) {
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
 * @param {string} jsonText
 * @param {Storage} [storage]
 * @returns {{ ok: true, imported: number } | { ok: false, error: string }}
 */
export function importPresetsFromJson(jsonText, storage = defaultStorage()) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.presets)) {
    return { ok: false, error: 'UNSUPPORTED_SCHEMA' };
  }
  const existing = listPresets(storage);
  const existingIds = new Set(existing.map((p) => p.id));
  const incoming = parsed.presets.filter((p) => p && typeof p.name === 'string' && typeof p.id === 'string' && p.settings);
  // Imported presets with a colliding id get a fresh one rather than silently overwriting.
  const deduped = incoming.map((p) => (existingIds.has(p.id) ? { ...p, id: generatePresetId() } : p));
  const ok = writePresets([...existing, ...deduped], storage);
  return ok ? { ok: true, imported: deduped.length } : { ok: false, error: 'STORAGE_UNAVAILABLE' };
}

/**
 * @typedef {object} Favorite
 * @property {string} language
 * @property {string} contentId
 */

/**
 * @param {Storage} [storage]
 * @returns {Favorite[]} empty array if storage is unavailable or empty — never throws
 */
export function listFavorites(storage = defaultStorage()) {
  if (!checkStorageCapability(storage)) return [];
  try {
    const raw = storage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Favorite[]} favorites
 * @param {Storage} storage
 * @returns {boolean} true if the write actually succeeded
 */
function writeFavorites(favorites, storage) {
  if (!checkStorageCapability(storage)) return false;
  try {
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} language
 * @param {string} contentId
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function isFavorite(language, contentId, storage = defaultStorage()) {
  return listFavorites(storage).some((f) => f.language === language && f.contentId === contentId);
}

/**
 * Adds a content reference to favorites (a no-op, reported as success, if
 * already favorited — blueprint: "Favorite: {language, contentId}", no
 * separate id, so identity is the pair itself).
 * @param {string} language
 * @param {string} contentId
 * @param {Storage} [storage]
 * @returns {boolean} true if the write actually succeeded
 */
export function addFavorite(language, contentId, storage = defaultStorage()) {
  const existing = listFavorites(storage);
  if (existing.some((f) => f.language === language && f.contentId === contentId)) return true;
  return writeFavorites([...existing, { language, contentId }], storage);
}

/**
 * @param {string} language
 * @param {string} contentId
 * @param {Storage} [storage]
 * @returns {boolean} true if the write actually succeeded
 */
export function removeFavorite(language, contentId, storage = defaultStorage()) {
  const existing = listFavorites(storage);
  return writeFavorites(existing.filter((f) => !(f.language === language && f.contentId === contentId)), storage);
}

/**
 * Deletes only this application's own localStorage keys (blueprint 13: "A
 * Reset action deletes only this application's keys, never every key in
 * localStorage") — presets and favorites. Never touches anything else a
 * shared school computer's browser profile might hold.
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
