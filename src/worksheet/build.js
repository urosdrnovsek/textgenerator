/**
 * Builds the shared worksheet document model from an explicit content
 * entry, settings, and asset lookup. No random selection, no DOM, no
 * storage, no Word objects — those are separate concerns (blueprint
 * section 3's module responsibility table).
 */

import { resolvePersonalization, splitIntoSentences } from '../text/prepare.js';
import { buildStyledRuns, splitRunsIntoSentences, lightenParagraphs, countWords } from '../text/runs.js';

/**
 * @typedef {object} ImageAsset
 * @property {string} id
 * @property {string} path relative path, resolved by the caller's asset base
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {object} WorksheetSettings
 * @property {string} fontId
 * @property {number} fontSizePt
 * @property {number} lineHeightMultiplier
 * @property {number} letterSpacingPt
 * @property {number} extraWordSpacePt
 * @property {'read-copy' | 'trace' | 'read-only'} writingMode
 * @property {string} rulingId
 * @property {number} guideHeightMm
 * @property {Record<string, string>} letterColors
 * @property {'off' | 'colors' | 'separators' | 'both'} syllableMode
 * @property {[string, string]} [syllableColors]
 * @property {boolean} [sentencePerLine]
 * @property {string} [tintId] key into config.TINTS_BY_ID
 * @property {boolean} [printTint] whether the tint also shows when printed (default off, to save ink)
 * @property {boolean} [lineStripes] alternating faint background per real measured visual line — HTML/PDF only, see src/export/docx.js's header comment for why
 * @property {boolean} [printStripes] whether stripes also show when printed (default off, to save ink)
 * @property {{ nameLine: boolean, date: boolean, title: boolean }} header
 * @property {{ name?: string }} [personalization]
 * @property {number} marginMm
 * @property {number} pageWidthMm
 * @property {number} pageHeightMm
 */

/**
 * @typedef {object} WorksheetModel
 * @property {{ language: string, id: string, version: number }} contentKey
 * @property {string} title
 * @property {import('../text/runs.js').StyledRun[][]} bodyParagraphs one array of runs per line — a single element unless settings.sentencePerLine is on
 * @property {number} wordCount
 * @property {number} level
 * @property {ImageAsset} image
 * @property {WorksheetSettings} settings
 * @property {{ nameLine: boolean, date: boolean, title: boolean, titleText: string }} header
 */

/**
 * @param {import('../content/validate.js').ContentEntry} entry
 * @param {WorksheetSettings} settings
 * @param {{ imagesById: Map<string, ImageAsset> }} assets
 * @param {string} localeForWordCount e.g. "sl"
 * @returns {WorksheetModel}
 */
export function buildWorksheet(entry, settings, assets, localeForWordCount) {
  const resolvedText = resolvePersonalization(entry, settings.personalization?.name);

  const bodyRuns = buildStyledRuns(resolvedText, {
    letterColors: settings.letterColors,
    syllableMode: settings.syllableMode,
    syllableColors: settings.syllableColors
  });

  const sentenceParagraphs = settings.sentencePerLine
    ? splitRunsIntoSentences(bodyRuns, splitIntoSentences(resolvedText.body))
    : [bodyRuns];

  // Trace: light solid text (blueprint 8.7) — computed once here so HTML
  // and DOCX render identical colors, never two implementations of "light".
  const bodyParagraphs = settings.writingMode === 'trace'
    ? lightenParagraphs(sentenceParagraphs)
    : sentenceParagraphs;

  const image = assets.imagesById.get(entry.imageId);
  if (!image) {
    throw new Error(`MISSING_IMAGE: no asset registered for imageId "${entry.imageId}"`);
  }

  return {
    contentKey: { language: entry.language ?? localeForWordCount, id: entry.id, version: entry.version },
    title: entry.title,
    bodyParagraphs,
    wordCount: countWords(resolvedText.body, localeForWordCount),
    level: entry.level,
    // Shared reference to an asset-registry entry; safe only because those
    // entries are never mutated (a custom image is a new object, content
    // import sets new entries). Don't start mutating them.
    image,
    // A model is a snapshot. main.js mutates its live settings object in
    // place on every control change, so storing it by reference made every
    // packet sheet silently follow later changes at print time while its
    // frozen layout/page count described the old settings — the real cause
    // of what was mis-documented in 0.8 as a Chromium print-engine bug.
    settings: structuredClone(settings),
    header: {
      nameLine: settings.header.nameLine,
      date: settings.header.date,
      title: settings.header.title,
      titleText: entry.title
    }
  };
}
