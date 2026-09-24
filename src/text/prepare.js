/**
 * Canonical text helpers with no browser or storage dependency.
 *
 * Until 0.8.1 this module also resolved a `{name}` placeholder against a
 * teacher-typed child name. That feature was removed (see CHANGELOG): the
 * story texts now carry a fixed child name, because a typed name of the
 * "other" gender produced ungrammatical text — pronouns in English, and
 * gendered verb and adjective forms in Slovene, which no substitution can
 * fix without a second, fully authored version of every story.
 */

/**
 * Splits on a paragraph break, or a run of non-terminator characters
 * followed by ./!/? (or end of paragraph). Algorithmic rather than
 * author-marked: unlike syllable boundaries (which have real per-language
 * phonological rules and are explicitly never to be guessed — blueprint
 * 8.2), terminal punctuation is a reliable sentence-boundary signal, and
 * none of the current content authors sentence boundaries explicitly.
 *
 * A closing quote/bracket is allowed to sit between the terminator and the
 * following whitespace ("prideš!« so vpili.") — found via a real content
 * entry using Slovene dialogue quoting (»...«), which was silently dropping
 * the entire quoted sentence before this was added.
 */
const CLOSING_MARKS = '»«"\'“”‘’)\\]';
// A sentence runs lazily from a non-space character to the first terminator
// run (plus closing marks) that is followed by whitespace or the end of the
// paragraph. A terminator followed by anything else ("Ziel!“, riefen sie")
// stays inside the sentence. The older pattern could not match such a
// quoted exclamation at all, so the regex skipped it and the words vanished
// from sentence-per-line sheets (found 2026-09-24 in a German and a Spanish
// story). Everything between two matches is now whitespace by construction.
const SENTENCE_PATTERN = new RegExp(`\\S[\\s\\S]*?(?:[.!?]+[${CLOSING_MARKS}]*(?=\\s|$)|$)`, 'g');

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
