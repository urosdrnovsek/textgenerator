/**
 * Personalization and canonical text resolution.
 *
 * Resolves the `{name}` placeholder against a validated ContentEntry.
 * Owns no browser or storage dependency.
 */

const NAME_PLACEHOLDER = '{name}';
/** Matches {name} at the very start of the text or right after sentence-ending punctuation, capturing the letter that follows so it can be re-capitalized once the placeholder is gone. */
const SENTENCE_START_NAME_PATTERN = /(^|[.!?]\s+)\{name\}\s*([\p{L}]?)/gu;

/**
 * @typedef {object} ResolvedText
 * @property {string} body
 * @property {string | undefined} syllableBody syllable markers only survive
 *   when personalization did not need to touch the text
 * @property {boolean} personalized
 */

/**
 * @param {{ body: string, syllable_body?: string, neutral_body?: string, neutral_syllable_body?: string }} entry
 * @param {string | undefined} name teacher-supplied child name, already trimmed by the caller's UI layer
 * @returns {ResolvedText}
 */
export function resolvePersonalization(entry, name) {
  const trimmedName = (name ?? '').trim();

  if (!entry.body.includes(NAME_PLACEHOLDER)) {
    return { body: entry.body, syllableBody: entry.syllable_body, personalized: false };
  }

  if (trimmedName.length === 0) {
    if (entry.neutral_body) {
      return { body: entry.neutral_body, syllableBody: entry.neutral_syllable_body, personalized: false };
    }
    // Phase 0 fallback: authored neutral_body is the correct long-term path
    // (see blueprint 8.8); blind removal is a documented simplification and
    // does not attempt grammatically-safe substitution (no declension, no
    // gender agreement — blueprint 8.8 explicitly says not to attempt that).
    // It does fix the one thing plain removal gets visibly wrong: dropping a
    // sentence-initial placeholder left the next word lowercase.
    const body = entry.body
      .replace(SENTENCE_START_NAME_PATTERN, (match, prefix, nextLetter) => prefix + nextLetter.toUpperCase())
      .replaceAll(NAME_PLACEHOLDER, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,!?])/g, '$1')
      .trim();
    return { body, syllableBody: undefined, personalized: false };
  }

  const body = entry.body.replaceAll(NAME_PLACEHOLDER, trimmedName);
  // The inserted name has no authored syllable boundaries, so syllable
  // coloring is not available on a personalized passage in Phase 0.
  return { body, syllableBody: undefined, personalized: true };
}

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
 * @param {string} text already-resolved body text (post-personalization)
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
