/**
 * Where a text's sentences and paragraphs begin and end. Pure.
 */

/**
 * Sentences end at ./!/? (or a paragraph's end). Found, not marked by the
 * author: unlike syllables, which are never guessed, end punctuation is a
 * reliable sign. A closing quote or bracket may sit between the terminator
 * and the space after it (»… prideš!« so vpili.).
 */
const CLOSING_MARKS = '»«"\'“”‘’)\\]';
// A sentence runs lazily from a non-space character to the first terminator
// run (plus closing marks) that is followed by whitespace or the end of the
// paragraph. A terminator followed by anything else ("Ziel!“, riefen sie")
// stays inside the sentence, so only whitespace ever falls between two
// sentences. Two more rules (see `npm run sentence-report`):
// - A terminator followed by a lowercase word does not end the sentence:
//   no sentence in these languages starts in lowercase, but dialogue tags
//   (»…prideš!« so vpili.), ordinals (v 15. stoletju) and French spaced
//   closing marks (… ! » crient les autres.) continue one.
// - A lone » between spaces right after a terminator is a French closing
//   guillemet and stays with that sentence (« … pas. » Chaque matin).
//   Unambiguous without knowing the language: Slovene and German attach
//   their » to the word it opens (»Besedilo), never with a space after.
const SENTENCE_PATTERN = new RegExp(
  // After the terminator: skip every space and quote mark, then the next
  // character must not be a lowercase letter.
  `\\S[\\s\\S]*?(?:[.!?]+[${CLOSING_MARKS}]*(?:\\s»(?=\\s|$))?(?=\\s*$|\\s[\\s${CLOSING_MARKS}]*(?![\\s${CLOSING_MARKS}\\p{Ll}]))|$)`,
  'gu'
);

/**
 * @param {string} text the entry's body text
 * @returns {string[]} one entry per authored paragraph (split on newlines), trimmed, empty ones dropped
 */
export function splitIntoParagraphs(text) {
  return text.split(/\n+/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
}

/**
 * The one sentence rule of the app, as offsets: sentence-per-line, the
 * tokenizer's sentence index for each word (src/text/tokenize.js) and any
 * later sentence-based activity all derive from this, so they can't
 * disagree about where a sentence starts and ends.
 * @param {string} text
 * @returns {Array<{ start: number, end: number }>} trimmed sentence ranges in `text` (UTF-16 offsets, end exclusive), in order; a paragraph break always ends a sentence
 */
export function splitSentenceRanges(text) {
  const ranges = [];
  for (const paragraph of text.matchAll(/[^\n]+/g)) {
    for (const match of paragraph[0].matchAll(SENTENCE_PATTERN)) {
      const start = paragraph.index + match.index;
      let end = start + match[0].length;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end > start) ranges.push({ start, end });
    }
  }
  return ranges;
}

/**
 * @param {string} text the entry's body text
 * @returns {string[]} one entry per sentence, trimmed, empty ones dropped
 */
export function splitIntoSentences(text) {
  return splitSentenceRanges(text).map(({ start, end }) => text.slice(start, end));
}
