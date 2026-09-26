/**
 * Per-text choices the teacher makes by clicking the preview (handbook
 * §11.8): which words are gaps, which sentence to copy, whether to print
 * the answers. Pure: every operation returns a new selection and never
 * touches its input. Selections are session-only — never in presets.
 *
 * A selection belongs to one text version (`key`). worksheet/build.js
 * ignores one whose key doesn't match the entry, so a gap chosen for a
 * text never lands on a different or changed text.
 */

import { CLOZE } from '../config.js';

/**
 * @typedef {object} Selection
 * @property {string} key keyFor(entry)
 * @property {number[]} blanks word indices (tokenize.js), ascending, distinct
 * @property {number | null} sentence the sentence to copy (copy target 'sentence')
 * @property {boolean} showAnswers print the answer key: gaps show their word
 */

/**
 * @param {{ language?: string, id: string, version: number }} entry
 * @returns {string} e.g. "en:stories_kite_3@1"
 */
export function keyFor(entry) {
  return `${entry.language}:${entry.id}@${entry.version}`;
}

/**
 * @param {string} key
 * @returns {Selection}
 */
export function emptySelection(key) {
  return { key, blanks: [], sentence: null, showAnswers: false };
}

/**
 * The most gaps a text may have: beyond this share of its words a
 * gap-fill stops being readable.
 * @param {import('../text/tokenize.js').TextDoc} doc
 */
export function maxBlanks(doc) {
  return Math.floor(doc.words.length * CLOZE.maxGapShare);
}

/**
 * Turns a word into a gap, or back. Refuses (without changing anything)
 * when that would pass the cap.
 * @param {Selection} selection
 * @param {number} w
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @returns {{ ok: true, selection: Selection } | { ok: false, code: 'TOO_MANY_GAPS', max: number }}
 */
export function toggleBlank(selection, w, doc) {
  if (!Number.isInteger(w) || w < 0 || w >= doc.words.length) return { ok: true, selection };
  if (selection.blanks.includes(w)) {
    return { ok: true, selection: { ...selection, blanks: selection.blanks.filter((b) => b !== w) } };
  }
  if (selection.blanks.length + 1 > maxBlanks(doc)) return { ok: false, code: 'TOO_MANY_GAPS', max: maxBlanks(doc) };
  return { ok: true, selection: { ...selection, blanks: [...selection.blanks, w].sort((a, b) => a - b) } };
}

/**
 * The classic cloze pattern: every nth word becomes a gap, replacing the
 * current gaps. The first sentence stays whole, to give the context
 * (standard cloze procedure); counting starts with the second sentence.
 * @param {Selection} selection
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @param {number} n clamped to CLOZE.everyNth
 * @returns {Selection}
 */
export function blankEveryNth(selection, doc, n) {
  const step = Math.min(CLOZE.everyNth.max, Math.max(CLOZE.everyNth.min, Math.round(n)));
  const rest = doc.words.filter((word) => word.sentence > 0);
  const blanks = rest.filter((_, i) => (i + 1) % step === 0).map((word) => word.w).slice(0, maxBlanks(doc));
  return { ...selection, blanks };
}

/**
 * @param {Selection} selection
 * @returns {Selection}
 */
export function clearBlanks(selection) {
  return { ...selection, blanks: [] };
}

/**
 * The sentence to copy (copy target "one sentence"): clicking the chosen
 * sentence again un-chooses it.
 * @param {Selection} selection
 * @param {number} sentence index into TextDoc.sentences
 * @returns {Selection}
 */
export function chooseSentence(selection, sentence) {
  return { ...selection, sentence: selection.sentence === sentence ? null : sentence };
}

/**
 * The selection a model may use for this entry: the given one when its key
 * matches (with out-of-range or duplicate indices dropped), otherwise an
 * empty one — and `reset` says a non-empty selection was thrown away.
 * @param {Selection | undefined} selection
 * @param {string} key
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @returns {{ selection: Selection, reset: boolean }}
 */
export function selectionFor(selection, key, doc) {
  if (!selection) return { selection: emptySelection(key), reset: false };
  if (selection.key !== key) {
    const hadChoices = selection.blanks.length > 0 || selection.sentence !== null;
    return { selection: emptySelection(key), reset: hadChoices };
  }
  const blanks = [...new Set(selection.blanks)]
    .filter((w) => Number.isInteger(w) && w >= 0 && w < doc.words.length)
    .sort((a, b) => a - b)
    .slice(0, maxBlanks(doc));
  const sentence = Number.isInteger(selection.sentence) && selection.sentence >= 0 && selection.sentence < doc.sentences.length
    ? selection.sentence
    : null;
  return { selection: { key, blanks, sentence, showAnswers: Boolean(selection.showAnswers) }, reset: false };
}

/**
 * One width for every gap on a sheet, so a gap's length doesn't give the
 * answer away; sized for a child's handwriting of the longest answer.
 * @param {import('../text/tokenize.js').TextDoc} doc
 * @param {number[]} blanks
 * @returns {number} em
 */
export function blankWidthEm(doc, blanks) {
  const longest = Math.max(0, ...blanks.map((w) => [...doc.words[w].text].length));
  return Math.max(CLOZE.minGapEm, CLOZE.charWidthEm * longest * CLOZE.handwritingFactor);
}
