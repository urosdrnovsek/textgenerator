/**
 * The texts on offer, per language: the bundled pack (or a pack the
 * teacher imported for this session), then the teacher's own texts at the
 * end of each cell. Validates every bundled pack when created, so a broken
 * pack fails at startup, not when its language is first chosen.
 */

import { validatePack } from './validate.js';
import { buildCatalogIndex } from './catalog.js';
import { ownTextEntry } from './ownText.js';

/**
 * @param {object} options
 * @param {Record<string, unknown>} options.packs bundled content pack per language code
 * @param {Set<string>} options.assetIds the bundled pictures' ids
 * @param {import('./ownText.js').OwnText[]} options.ownTexts from this browser's storage
 */
export function createLibrary({ packs, assetIds, ownTexts }) {
  /** @type {Record<string, import('./catalog.js').CatalogEntry[]>} each language's texts before the own ones */
  const baseEntries = {};
  /** @type {Record<string, import('./catalog.js').CatalogIndex>} */
  const catalogs = {};
  let own = ownTexts;

  /** @param {string} language */
  function rebuild(language) {
    const ownEntries = own.filter((text) => text.language === language).map(ownTextEntry);
    catalogs[language] = buildCatalogIndex([...baseEntries[language], ...ownEntries]);
  }

  for (const [language, pack] of Object.entries(packs)) {
    const validation = validatePack(pack, assetIds);
    if (!validation.ok) {
      // eslint-disable-next-line no-console
      console.error(`Content pack "${language}" failed validation:`, validation.errors);
      throw new Error(`Content pack "${language}" failed validation — see console for details.`);
    }
    baseEntries[language] = validation.pack.entries.map((entry) => ({ ...entry, language }));
    rebuild(language);
  }

  return {
    /** @param {string} language */
    catalog: (language) => catalogs[language],

    ownTexts: () => own,

    /** @param {import('./ownText.js').OwnText[]} texts every own text, in every language */
    setOwnTexts(texts) {
      own = texts;
      for (const language of Object.keys(catalogs)) rebuild(language);
    },

    /**
     * A content pack imported for this session replaces the language's texts;
     * the own texts stay.
     * @param {string} language
     * @param {import('./catalog.js').CatalogEntry[]} entries
     */
    replaceTexts(language, entries) {
      baseEntries[language] = entries;
      rebuild(language);
    }
  };
}

/** @typedef {ReturnType<typeof createLibrary>} Library */
