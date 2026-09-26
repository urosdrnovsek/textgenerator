/**
 * Builds the shared worksheet document model from an explicit content
 * entry, settings, and asset lookup. No random selection, no DOM, no
 * storage, no Word objects — those are separate concerns (blueprint
 * section 3's module responsibility table).
 */

import { splitIntoSentences, splitIntoParagraphs } from '../text/prepare.js';
import { styleText, splitRunsIntoSentences, lightenParagraphs, lightenColor, TRACE_LIGHTEN, countWords } from '../text/runs.js';
import { tokenize } from '../text/tokenize.js';
import { keyFor, selectionFor, blankWidthEm, printedQuestions } from './selection.js';
import { seededDerangement, sequenceLength } from './sequence.js';
import { ACTIVITIES } from './activities.js';
import { DRAWING_BOX_HEIGHT_MM, ARC_COLOR, STARTER_SENTENCES, QUESTIONS } from '../config.js';

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
 * @property {boolean} [clozeWordBank] gap-fill: print the missing words in a box above the text (default off)
 * @property {boolean} [syllableArcs] a curve under each syllable (HTML/print only; needs syllable data) (default off)
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
 * @property {ImageAsset | null} image the sheet's picture asset (an image block, when present, shows this one); null for an own text without a picture
 * @property {WorksheetSettings} settings
 * @property {Block[]} blocks the page's content in order, above the task region (upgrade blueprint §11.5.3)
 * @property {import('./selection.js').Selection} selection the clicks this model was built with (a snapshot)
 * @property {'passage' | 'first-sentences' | 'sentence' | 'title'} copyTarget what the child copies (always 'passage' outside read & copy)
 * @property {string} copyTargetText that text, for layout/copyEstimate.js ('' when nothing is copied: another activity, or "one sentence" with none chosen)
 * @property {boolean} hasSyllableData the text has syllable data (syllable colours, separators and arcs need it)
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
 *   | { type: 'title', text: string, copyMark: boolean } copyMark: the title is what the child copies
 *   | { type: 'instruction', key: string } text: labels.instruction(key), in the sheet's language
 *   | { type: 'image', size: 'normal' | 'large' }
 *   | { type: 'passage', paragraphs: import('../text/runs.js').StyledRun[][], lineNumbers: boolean, blankWidthEm: number, showAnswers: boolean, copyMark: { firstW: number, lastW: number } | null, arcColor: string | null } arcColor: syllable arcs are drawn, in this colour (null: none) blankWidthEm: every gap's width (0 = no gaps); showAnswers: the answer key (gaps show their word)
 *   | { type: 'drawingBox', heightMm: number }
 *   | { type: 'questions', items: string[], linesEach: number }
 *   | { type: 'wordBank', words: string[] } gap-fill: the missing words, alphabetical, in a box above the text the teacher's own questions, each followed by ruled answer lines
 *   | { type: 'sequence', items: Array<{ runs: import('../text/runs.js').StyledRun[], position: number }>, sentenceCount: number, showAnswers: boolean } items: shuffled, position = the sentence's place in the text (1-based); no items when the text has too few sentences
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
  // A story starter keeps only its first sentences.
  const bodyParagraphs = activity.passage === 'traced'
    ? lightenParagraphs(sentenceParagraphs)
    : activity.passage === 'starter'
      ? starterParagraphs(bodyRuns, doc, Boolean(settings.sentencePerLine))
      : sentenceParagraphs;

  // Syllable arcs need syllable data; in trace mode they are lightened like the text.
  const arcColor = settings.syllableArcs && doc.hasSyllables
    ? (activity.passage === 'traced' ? lightenColor(ARC_COLOR, TRACE_LIGHTEN) : ARC_COLOR)
    : null;

  // "Put in order": the first 3–6 sentences, cut from the same styled runs
  // (so every reading support applies), in a fixed shuffled order.
  const sequence = activity.sequence ? buildSequence(bodyRuns, resolvedText.body, entry.id) : null;
  // A key only when there is something to answer: gaps, or sentences to number.
  const answerKey = chosen.selection.showAnswers && Boolean(activity.answers)
    && (activity.sequence ? sequence.items.length > 0 : blanks.length > 0);

  // Only lines meant for copying have a copy text. Write about the picture
  // has lines too, but nothing to copy: until 0.10.0-rc.1's fix it fell back
  // to the whole (hidden) text and was told "About N lines are needed to
  // copy this".
  const target = activity.copyTarget
    ? resolveCopyTarget(settings.copyTarget ?? 'passage', doc, chosen.selection, entry.title)
    : { kind: 'passage', text: '', words: null };

  // An own text may have no picture (imageId null): then there is no image
  // block, unless the teacher uploaded a custom image for it. For any other
  // entry a missing asset is a bug.
  const image = assets.imagesById.get(entry.imageId) ?? null;
  if (!image && entry.imageId !== null) {
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
    hasSyllableData: doc.hasSyllables,
    copyTarget: target.kind,
    copyTargetText: target.text,
    blocks: buildBlocks(entry, settings, activity, bodyParagraphs, blanks.length > 0 ? blankWidthEm(doc, blanks) : 0, answerKey, target, sequence, arcColor, printedQuestions(chosen.selection.questions),
      settings.clozeWordBank && blanks.length > 0 ? wordBank(doc, blanks, entry.language ?? localeForWordCount) : null, image !== null),
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
 * @param {CopyTarget} target
 * @param {{ items: Array<{ runs: import('../text/runs.js').StyledRun[], position: number }>, sentenceCount: number } | null} sequence
 * @param {string | null} arcColor
 * @param {string[]} questions the teacher's own questions (already cleaned)
 * @param {string[] | null} bankWords gap-fill word bank, or null for none
 * @param {boolean} hasPicture the text has a picture (an own text may not)
 * @returns {Block[]}
 */
function buildBlocks(entry, settings, activity, paragraphs, gapWidthEm, answerKey, target, sequence, arcColor, questions, bankWords, hasPicture) {
  /** @type {Block[]} */
  const blocks = [];
  // First, whatever else is switched off: a key must never pass for a student sheet.
  if (answerKey) blocks.push({ type: 'answerTag' });
  if (settings.header.nameLine || settings.header.date) {
    blocks.push({ type: 'header', nameLine: settings.header.nameLine, date: settings.header.date });
  }
  if (settings.header.title) blocks.push({ type: 'title', text: entry.title, copyMark: target.kind === 'title' });
  if (activity.instruction && settings.header.instructions !== false) {
    blocks.push({ type: 'instruction', key: activity.instruction });
  }
  const imageSlot = settings.imageSlot ?? 'picture';
  if (imageSlot === 'picture' && hasPicture) blocks.push({ type: 'image', size: activity.imageSize ?? 'normal' });
  // Above the text: the child reads the words first, then fills them in.
  if (bankWords) blocks.push({ type: 'wordBank', words: bankWords });
  if (activity.passage !== 'hidden') {
    blocks.push({ type: 'passage', paragraphs, lineNumbers: Boolean(settings.lineNumbers), blankWidthEm: gapWidthEm, showAnswers: answerKey, copyMark: target.words, arcColor });
  }
  if (sequence) blocks.push({ type: 'sequence', ...sequence, showAnswers: answerKey });
  // Straight after the text they are about, before a drawing box or copy lines.
  if (questions.length > 0) blocks.push({ type: 'questions', items: questions, linesEach: QUESTIONS.linesEach });
  // After the passage: the child draws what they have just read.
  if (imageSlot === 'drawing-box') blocks.push({ type: 'drawingBox', heightMm: DRAWING_BOX_HEIGHT_MM });
  return blocks;
}

/**
 * @typedef {object} CopyTarget
 * @property {'passage' | 'first-sentences' | 'sentence' | 'title'} kind
 * @property {string} text what the child copies ('' when nothing is chosen yet)
 * @property {{ firstW: number, lastW: number } | null} words the passage words to mark (null: none — the whole text, the title, or nothing chosen)
 */

/**
 * What the child copies in read & copy (handbook §11.6 A3), resolved on
 * the text: "the first two sentences" (one, if that is all there is), the
 * sentence the teacher clicked, the title, or the whole text (unmarked).
 * @param {'passage' | 'first-sentences' | 'sentence' | 'title'} kind
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @param {import('./selection.js').Selection} selection
 * @param {string} title
 * @returns {CopyTarget}
 */
function resolveCopyTarget(kind, doc, selection, title) {
  const sentenceRange = (from, to) => {
    const words = doc.words.filter((word) => word.sentence >= from && word.sentence <= to);
    if (words.length === 0) return null;
    return { firstW: words[0].w, lastW: words.at(-1).w };
  };
  if (kind === 'title') return { kind, text: title, words: null };
  if (kind === 'first-sentences') {
    const last = Math.min(1, doc.sentences.length - 1);
    return { kind, text: doc.body.slice(doc.sentences[0].start, doc.sentences[last].end), words: sentenceRange(0, last) };
  }
  if (kind === 'sentence') {
    const s = selection.sentence;
    if (s === null) return { kind, text: '', words: null };
    return { kind, text: doc.body.slice(doc.sentences[s].start, doc.sentences[s].end), words: sentenceRange(s, s) };
  }
  return { kind: 'passage', text: doc.body, words: null };
}

/**
 * @param {import('../text/runs.js').StyledRun[]} bodyRuns
 * @param {string} body
 * @param {string} entryId the shuffle's seed (not the version: a corrected text keeps its order)
 */
function buildSequence(bodyRuns, body, entryId) {
  const sentences = splitRunsIntoSentences(bodyRuns, splitIntoSentences(body));
  const count = sequenceLength(sentences.length);
  const order = count > 0 ? seededDerangement(count, entryId) : [];
  return { items: order.map((original) => ({ runs: sentences[original], position: original + 1 })), sentenceCount: sentences.length };
}

/**
 * "Continue the text": the first STARTER_SENTENCES sentences — fewer when
 * the text is short, so at least one sentence is left for the child to
 * write on from (a one-sentence text keeps its sentence). Cut from the
 * same styled runs, so every reading support applies; one paragraph per
 * sentence with sentence-per-line, else one paragraph.
 * @param {import('../text/runs.js').StyledRun[]} bodyRuns
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @param {boolean} sentencePerLine
 * @returns {import('../text/runs.js').StyledRun[][]}
 */
function starterParagraphs(bodyRuns, doc, sentencePerLine) {
  const count = Math.max(1, Math.min(STARTER_SENTENCES, doc.sentences.length - 1));
  const kept = doc.sentences.slice(0, count);
  const texts = sentencePerLine
    ? kept.map(({ start, end }) => doc.body.slice(start, end))
    : [doc.body.slice(kept[0].start, kept.at(-1).end)];
  return splitRunsIntoSentences(bodyRuns, texts);
}

/**
 * Gap-fill word bank: the missing words as written in the text, in the
 * text language's alphabetical order (so the order gives nothing away).
 * A word gapped twice is listed twice.
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @param {number[]} blanks
 * @param {string} language
 * @returns {string[]}
 */
function wordBank(doc, blanks, language) {
  const collator = new Intl.Collator(language, { sensitivity: 'base' });
  return blanks.map((w) => doc.words[w].text).sort(collator.compare);
}
