/**
 * Builds the shared worksheet document model from an explicit content
 * entry, settings, and asset lookup. No random selection, no DOM, no
 * storage, no Word objects — those are separate concerns (blueprint
 * section 3's module responsibility table).
 */

import { splitIntoSentences, splitIntoParagraphs } from '../text/prepare.js';
import { buildStyledRuns, splitRunsIntoSentences, lightenParagraphs, countWords } from '../text/runs.js';
import { ACTIVITIES } from './activities.js';

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
 * @property {number} marginMm
 * @property {number} pageWidthMm
 * @property {number} pageHeightMm
 */

/**
 * @typedef {object} WorksheetModel
 * @property {{ language: string, id: string, version: number }} contentKey
 * @property {string} title
 * @property {import('../text/runs.js').StyledRun[][]} bodyParagraphs one array of runs per paragraph — one per sentence when settings.sentencePerLine is on, otherwise one per authored paragraph of the body
 * @property {number} wordCount
 * @property {number} level
 * @property {ImageAsset} image the sheet's picture asset (an image block, when present, shows this one)
 * @property {WorksheetSettings} settings
 * @property {Block[]} blocks the page's content in order, above the task region (upgrade blueprint §11.5.3)
 * @property {'lines' | 'none'} task what follows the blocks: ruled copy rows filling the rest of the page, or nothing — a layout decision made by layout/measure.js, not a block
 */

/**
 * One piece of the page. Both adapters (render/html.js BLOCK_RENDERERS,
 * export/docx.js BLOCK_WRITERS) handle exactly these types, and a test
 * holds their key sets equal.
 * @typedef {(
 *   | { type: 'header', nameLine: boolean, date: boolean }
 *   | { type: 'title', text: string }
 *   | { type: 'image' }
 *   | { type: 'passage', paragraphs: import('../text/runs.js').StyledRun[][] }
 * )} Block
 */

/**
 * @param {import('../content/validate.js').ContentEntry} entry
 * @param {WorksheetSettings} settings
 * @param {{ imagesById: Map<string, ImageAsset> }} assets
 * @param {string} localeForWordCount e.g. "sl"
 * @returns {WorksheetModel}
 */
export function buildWorksheet(entry, settings, assets, localeForWordCount) {
  // The entry's text is used as authored — there is no placeholder
  // substitution step any more (the child-name feature was removed; see
  // src/text/prepare.js).
  const resolvedText = { body: entry.body, syllableBody: entry.syllable_body };

  const bodyRuns = buildStyledRuns(resolvedText, {
    letterColors: settings.letterColors,
    syllableMode: settings.syllableMode,
    syllableColors: settings.syllableColors
  });

  // Authored paragraph breaks ("\n\n" in body) become separate paragraphs.
  // Until 0.10 the whole body went into one paragraph, where HTML collapsed
  // the newlines to a space and DOCX kept them inside one w:t (printed as
  // spaces by LibreOffice), so 73 texts lost their paragraphing in every
  // output. splitRunsIntoSentences cuts at any list of trimmed segments,
  // so it serves paragraphs as well as sentences.
  const sentenceParagraphs = settings.sentencePerLine
    ? splitRunsIntoSentences(bodyRuns, splitIntoSentences(resolvedText.body))
    : splitRunsIntoSentences(bodyRuns, splitIntoParagraphs(resolvedText.body));

  const activity = ACTIVITIES[settings.writingMode];
  if (!activity) {
    throw new Error(`UNKNOWN_WRITING_MODE: "${settings.writingMode}"`);
  }

  // Trace: light solid text (blueprint 8.7) — computed once here so HTML
  // and DOCX render identical colors, never two implementations of "light".
  const bodyParagraphs = activity.passage === 'traced'
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
    blocks: buildBlocks(entry, settings, bodyParagraphs),
    task: activity.task
  };
}

/**
 * The page's blocks in order. Only this function decides what appears on
 * the page and where; the adapters and the fit check just walk the list.
 * @param {import('../content/validate.js').ContentEntry} entry
 * @param {WorksheetSettings} settings
 * @param {import('../text/runs.js').StyledRun[][]} paragraphs
 * @returns {Block[]}
 */
function buildBlocks(entry, settings, paragraphs) {
  /** @type {Block[]} */
  const blocks = [];
  if (settings.header.nameLine || settings.header.date) {
    blocks.push({ type: 'header', nameLine: settings.header.nameLine, date: settings.header.date });
  }
  if (settings.header.title) blocks.push({ type: 'title', text: entry.title });
  blocks.push({ type: 'image' });
  blocks.push({ type: 'passage', paragraphs });
  return blocks;
}
