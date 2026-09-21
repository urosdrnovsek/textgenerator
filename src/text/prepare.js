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
const SENTENCE_PATTERN = new RegExp(`[^.!?]+[.!?]+[${CLOSING_MARKS}]*(?=\\s|$)|[^.!?]+$`, 'g');

/**
 * @param {string} text the entry's body text
 * @returns {string[]} one entry per sentence, trimmed, empty ones dropped
 */
export function splitIntoSentences(text) {
  const paragraphs = text.split(/\n+/);
  const sentences = [];
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (trimmedParagraph.length === 0) continue;
    const matches = trimmedParagraph.match(SENTENCE_PATTERN) ?? [trimmedParagraph];
    for (const match of matches) {
      const sentence = match.trim();
      if (sentence.length > 0) sentences.push(sentence);
    }
  }
  return sentences;
}
