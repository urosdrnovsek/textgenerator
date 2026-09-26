/**
 * Builds the shared worksheet document model from an explicit content
 * entry, settings, and asset lookup. No random selection, no DOM, no
 * storage, no Word objects — those are separate concerns (blueprint
 * section 3's module responsibility table).
 */

import { splitIntoSentences, splitIntoParagraphs } from '../text/prepare.js';
import { styleText, splitRunsIntoSentences, lightenParagraphs, countWords } from '../text/runs.js';
import { tokenize } from '../text/tokenize.js';
import { keyFor, selectionFor, blankWidthEm } from './selection.js';
import { ACTIVITIES } from './activities.js';
import { DRAWING_BOX_HEIGHT_MM } from '../config.js';

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
 * @property {'read-copy' | 'trace' | 'read-only' | 'write-own'} writingMode
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
 * @property {boolean} [lineNumbers] numbers every passage line, continuously across pages (default off)
 * @property {boolean} [wordSpaceMarks] a faint "_" in every space between two words of a sentence (default off)
 * @property {import('../text/graphemes.js').GraphemeGroup[]} [graphemes] letter groups highlighted in colour and bold (default none)
 * @property {'picture' | 'drawing-box' | 'none'} [imageSlot] the text's picture above the passage, an empty drawing box after it, or neither (default 'picture')
 * @property {{ nameLine: boolean, date: boolean, title: boolean, instructions?: boolean }} header instructions: the activity's instruction line, when it has one (absent = on)
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
 * @property {import('./selection.js').Selection} selection the clicks this model was built with (a snapshot)
 * @property {boolean} selectionReset a selection for another text or version was ignored (worksheet/advice.js SELECTION_RESET)
 * @property {'lines' | 'none'} task what follows the blocks: ruled copy rows filling the rest of the page, or nothing — a layout decision made by layout/measure.js, not a block
 */

/**
 * One piece of the page. Both adapters (render/html.js BLOCK_RENDERERS,
 * export/docx.js BLOCK_WRITERS) handle exactly these types, and a test
 * holds their key sets equal.
 * @typedef {(
 *   | { type: 'answerTag' } an answer-key sheet's "Answers" tag (labels.answers), first on the page
 *   | { type: 'header', nameLine: boolean, date: boolean }
 *   | { type: 'title', text: string }
 *   | { type: 'instruction', key: string } text: labels.instruction(key), in the sheet's language
 *   | { type: 'image', size: 'normal' | 'large' }
 *   | { type: 'passage', paragraphs: import('../text/runs.js').StyledRun[][], lineNumbers: boolean, blankWidthEm: number, showAnswers: boolean } blankWidthEm: every gap's width (0 = no gaps); showAnswers: the answer key (gaps show their word)
 *   | { type: 'drawingBox', heightMm: number }
 * )} Block
 */

/**
 * @param {import('../content/validate.js').ContentEntry} entry
 * @param {WorksheetSettings} settings
 * @param {{ imagesById: Map<string, ImageAsset> }} assets
 * @param {string} localeForWordCount e.g. "sl"
 * @param {import('./selection.js').Selection} [selection] the teacher's clicks
 *   on this text; ignored (and reported as selectionReset) when its key
 *   belongs to another text or version
 * @returns {WorksheetModel}
 */
export function buildWorksheet(entry, settings, assets, localeForWordCount, selection) {
  // The entry's text is used as authored — there is no placeholder
  // substitution step any more (the child-name feature was removed; see
  // src/text/prepare.js).
  const resolvedText = { body: entry.body, syllableBody: entry.syllable_body };

  const activity = ACTIVITIES[settings.writingMode];
  if (!activity) {
    throw new Error(`UNKNOWN_WRITING_MODE: "${settings.writingMode}"`);
  }

  const doc = tokenize({ body: resolvedText.body, syllable_body: resolvedText.syllableBody });
  const chosen = selectionFor(selection, keyFor({ ...entry, language: entry.language ?? localeForWordCount }), doc);
  // Gaps only in an activity whose passage is a gap-fill; the selection
  // still travels in the model, so switching modes back keeps the clicks.
  const blanks = activity.passage === 'cloze' ? chosen.selection.blanks : [];

  const bodyRuns = styleText(doc, {
    letterColors: settings.letterColors,
    syllableMode: settings.syllableMode,
    syllableColors: settings.syllableColors,
    graphemes: settings.graphemes ?? [],
    wordSpaceMarks: Boolean(settings.wordSpaceMarks),
    blanks
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
    selection: chosen.selection,
    selectionReset: chosen.reset,
    blocks: buildBlocks(entry, settings, activity, bodyParagraphs, blanks.length > 0 ? blankWidthEm(doc, blanks) : 0, blanks.length > 0 && chosen.selection.showAnswers),
    task: activity.task
  };
}

/**
 * The page's blocks in order. Only this function decides what appears on
 * the page and where; the adapters and the fit check just walk the list.
 * @param {import('../content/validate.js').ContentEntry} entry
 * @param {WorksheetSettings} settings
 * @param {import('./activities.js').Activity} activity
 * @param {import('../text/runs.js').StyledRun[][]} paragraphs
 * @param {number} gapWidthEm the one width of every gap (0 without gaps)
 * @param {boolean} answerKey the gaps show their words, and the sheet says it is the key
 * @returns {Block[]}
 */
function buildBlocks(entry, settings, activity, paragraphs, gapWidthEm, answerKey) {
  /** @type {Block[]} */
  const blocks = [];
  // First, whatever else is switched off: a key must never pass for a student sheet.
  if (answerKey) blocks.push({ type: 'answerTag' });
  if (settings.header.nameLine || settings.header.date) {
    blocks.push({ type: 'header', nameLine: settings.header.nameLine, date: settings.header.date });
  }
  if (settings.header.title) blocks.push({ type: 'title', text: entry.title });
  if (activity.instruction && settings.header.instructions !== false) {
    blocks.push({ type: 'instruction', key: activity.instruction });
  }
  const imageSlot = settings.imageSlot ?? 'picture';
  if (imageSlot === 'picture') blocks.push({ type: 'image', size: activity.imageSize ?? 'normal' });
  if (activity.passage !== 'hidden') {
    blocks.push({ type: 'passage', paragraphs, lineNumbers: Boolean(settings.lineNumbers), blankWidthEm: gapWidthEm, showAnswers: answerKey });
  }
  // After the passage: the child draws what they have just read.
  if (imageSlot === 'drawing-box') blocks.push({ type: 'drawingBox', heightMm: DRAWING_BOX_HEIGHT_MM });
  return blocks;
}
