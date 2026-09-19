/**
 * Content catalog: id/(theme,level) indexes, candidate filtering, and
 * selection without immediate repetition (blueprint 8.2). Owns no DOM or
 * random-selection-hidden-inside-rendering — the caller always supplies the
 * rng, so selection stays deterministic under test.
 */

/**
 * @typedef {object} CatalogIndex
 * @property {Map<string, import('./validate.js').ContentEntry>} byId
 * @property {Map<string, import('./validate.js').ContentEntry[]>} byThemeLevel key is `${theme}|${level}`
 * @property {import('./validate.js').ContentEntry[]} entries
 */

/**
 * @param {import('./validate.js').ContentEntry[]} entries
 * @returns {CatalogIndex}
 */
export function buildCatalogIndex(entries) {
  const byId = new Map();
  const byThemeLevel = new Map();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    const key = `${entry.theme}|${entry.level}`;
    if (!byThemeLevel.has(key)) byThemeLevel.set(key, []);
    byThemeLevel.get(key).push(entry);
  }
  return { byId, byThemeLevel, entries };
}

/**
 * @param {CatalogIndex} catalog
 * @param {{ theme: string, level: number }} filter
 * @returns {import('./validate.js').ContentEntry[]} matching entries, empty array if none
 */
export function findCandidates(catalog, filter) {
  return catalog.byThemeLevel.get(`${filter.theme}|${filter.level}`) ?? [];
}

/**
 * Picks an entry from candidates, avoiding immediate repetition of
 * previousId when another candidate exists.
 * @param {import('./validate.js').ContentEntry[]} candidates
 * @param {string | null} previousId
 * @param {() => number} [rng] injected for deterministic tests; defaults to Math.random
 * @returns {import('./validate.js').ContentEntry | null}
 */
export function chooseEntry(candidates, previousId, rng = Math.random) {
  if (candidates.length === 0) return null;
  const pool = candidates.length > 1 ? candidates.filter((c) => c.id !== previousId) : candidates;
  const chosenFrom = pool.length > 0 ? pool : candidates;
  const index = Math.floor(rng() * chosenFrom.length);
  return chosenFrom[Math.min(index, chosenFrom.length - 1)];
}

/**
 * @param {CatalogIndex} catalog
 * @returns {string[]} known theme ids present in this catalog, in first-seen order
 */
export function listThemes(catalog) {
  const seen = new Set();
  const themes = [];
  for (const entry of catalog.entries) {
    if (!seen.has(entry.theme)) {
      seen.add(entry.theme);
      themes.push(entry.theme);
    }
  }
  return themes;
}
