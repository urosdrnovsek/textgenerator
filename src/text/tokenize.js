/**
 * The single definition of a *word*, a *sentence* and a *syllable
 * boundary* (upgrade blueprint §11.5.1), all expressed as UTF-16 offsets
 * into the NFC-normalized `body`. `syllable_body` is reduced to a list of
 * break offsets; the syllable invariant (stripping `|` reproduces `body`
 * after NFC — enforced by content/validate.js) guarantees they line up.
 *
 * A word's index `w` is its identity for everything the teacher may later
 * click (gaps, a chosen sentence): it depends only on the text, never on
 * formatting settings. Pure: no DOM, no settings, no state.
 *
 * Deliberately separate from countWords() in runs.js, which uses
 * Intl.Segmenter for the word count shown to the teacher; unifying the two
 * would change displayed counts and the level calibration (blueprint
 * §11.5.1).
 */

import { splitSentenceRanges } from './prepare.js';

/** Letters/marks/digits, with inner apostrophes or hyphens kept inside the word (don't, l’eau, Mont-Blanc). */
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * @typedef {object} Word
 * @property {number} w index among the text's words, from 0
 * @property {number} start offset in body
 * @property {number} end offset in body (exclusive)
 * @property {string} text
 * @property {number} sentence index into TextDoc.sentences
 * @property {number[]} syllableStarts body offsets where each of this word's syllables starts (the first is `start`)
 */

/**
 * @typedef {object} TextDoc
 * @property {string} body NFC-normalized
 * @property {Word[]} words
 * @property {Array<{ start: number, end: number }>} sentences
 * @property {number[]} syllableBreaks ascending body offsets where syllable_body had a `|`
 * @property {boolean} hasSyllables whether non-empty syllable data was supplied (a text of only one-syllable words still counts)
 */

/**
 * @param {string | undefined} syllableBody
 * @returns {number[]} ascending offsets, in the coordinates of syllableBody with every `|` removed
 */
export function syllableBreakOffsets(syllableBody) {
  const breaks = [];
  if (!syllableBody) return breaks;
  let offset = 0;
  for (const char of syllableBody) {
    if (char === '|') {
      breaks.push(offset); // a doubled `||` stays doubled, as it always rendered
    } else {
      offset += char.length; // code units, the same unit as String indices
    }
  }
  return breaks;
}

/**
 * @param {{ body: string, syllable_body?: string }} source a content entry, or any object with those fields
 * @returns {TextDoc}
 */
export function tokenize(source) {
  const body = source.body.normalize('NFC');
  const syllableBody = source.syllable_body?.normalize('NFC');
  const syllableBreaks = syllableBreakOffsets(syllableBody);
  const sentences = splitSentenceRanges(body);

  /** @type {Word[]} */
  const words = [];
  let sentence = 0;
  let breakIndex = 0;
  for (const match of body.matchAll(WORD_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    while (sentence < sentences.length - 1 && start >= sentences[sentence].end) sentence++;
    while (breakIndex < syllableBreaks.length && syllableBreaks[breakIndex] <= start) breakIndex++;
    const syllableStarts = [start];
    for (let b = breakIndex; b < syllableBreaks.length && syllableBreaks[b] < end; b++) syllableStarts.push(syllableBreaks[b]);
    words.push({ w: words.length, start, end, text: match[0], sentence, syllableStarts });
  }

  return { body, words, sentences, syllableBreaks, hasSyllables: Boolean(syllableBody) };
}

/**
 * @param {TextDoc} doc
 * @returns {Int32Array} for every body offset, the index of the word containing it, or -1
 */
export function wordIndexByOffset(doc) {
  const index = new Int32Array(doc.body.length).fill(-1);
  for (const word of doc.words) index.fill(word.w, word.start, word.end);
  return index;
}
