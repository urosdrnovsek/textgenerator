/**
 * Builds the shared worksheet document model from an explicit content
 * entry, settings, and asset lookup. No random selection, no DOM, no
 * storage, no Word objects — those are separate concerns (blueprint
 * section 3's module responsibility table).
 */

import { resolvePersonalization } from '../text/prepare.js';
import { buildStyledRuns, countWords } from '../text/runs.js';

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
 * @property {'off' | 'colors'} syllableMode
 * @property {[string, string]} [syllableColors]
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
 * @property {import('../text/runs.js').StyledRun[]} bodyRuns
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

  const image = assets.imagesById.get(entry.imageId);
  if (!image) {
    throw new Error(`MISSING_IMAGE: no asset registered for imageId "${entry.imageId}"`);
  }

  return {
    contentKey: { language: entry.language ?? localeForWordCount, id: entry.id, version: entry.version },
    title: entry.title,
    bodyRuns,
    wordCount: countWords(resolvedText.body, localeForWordCount),
    level: entry.level,
    image,
    settings,
    header: {
      nameLine: settings.header.nameLine,
      date: settings.header.date,
      title: settings.header.title,
      titleText: entry.title
    }
  };
}
