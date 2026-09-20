/**
 * Content catalog: id/(theme,level) indexes, candidate filtering, and
 * selection without immediate repetition (blueprint 8.2) — deterministic,
 * in pack order, so a second click always shows the next text. Owns no DOM.
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
 * Picks the entry after previousId in candidate order, wrapping around, or
 * the first candidate when previousId is not among them. Deterministic on
 * purpose (upgrade blueprint v3, workstream I7): "Create text" cycles
 * through a cell's texts in the order the pack lists them, so a teacher
 * clicking twice sees every text once and can predict what comes next;
 * random choice was a v2 assumption, not a requirement, and it made the
 * verify-* scripts' expected page counts depend on luck once a cell held
 * more than one entry.
 * @param {import('./validate.js').ContentEntry[]} candidates
 * @param {string | null} previousId
 * @returns {import('./validate.js').ContentEntry | null}
 */
export function chooseEntry(candidates, previousId) {
  if (candidates.length === 0) return null;
  const previousIndex = previousId === null ? -1 : candidates.findIndex((c) => c.id === previousId);
  return candidates[(previousIndex + 1) % candidates.length];
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
