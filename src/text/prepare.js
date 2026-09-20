/**
 * Personalization and canonical text resolution.
 *
 * Resolves the `{name}` placeholder against a validated ContentEntry.
 * Owns no browser or storage dependency.
 */

const NAME_PLACEHOLDER = '{name}';

/**
 * @typedef {object} ResolvedText
 * @property {string} body
 * @property {string | undefined} syllableBody syllable markers survive
 *   personalization in every case — either the entry's authored boundaries
 *   (no {name} used), or with the name substituted as its own chunk
 * @property {boolean} personalized true only when the teacher typed a name;
 *   false when the entry's name_default was used instead
 */

/**
 * Resolves the `{name}` placeholder. An entry that uses `{name}` always has
 * a validated `name_default` (enforced by content/validate.js) — there is no
 * "blank" state: an empty name field falls back to that default rather than
 * deleting the placeholder (upgrade blueprint v3, workstream B — the old
 * blind-removal fallback produced broken sentences like "Was spending the
 * summer..." and is deliberately not kept, not even as an option).
 * @param {{ body: string, syllable_body?: string, name_default?: string, name_default_syllables?: string }} entry
 * @param {string | undefined} name teacher-supplied child name, already trimmed and stripped of "|{}" by the caller's UI layer
 * @returns {ResolvedText}
 */
export function resolvePersonalization(entry, name) {
  if (!entry.body.includes(NAME_PLACEHOLDER)) {
    return { body: entry.body, syllableBody: entry.syllable_body, personalized: false };
  }

  const typedName = (name ?? '').trim();
  const usingTypedName = typedName.length > 0;
  const effectiveName = usingTypedName ? typedName : entry.name_default;
  // A teacher-typed name has no authored syllable boundaries, so it is
  // inserted as a single unsplit chunk; the default name may have its own
  // authored boundaries (name_default_syllables) and uses those instead.
  const effectiveSyllables = usingTypedName ? typedName : (entry.name_default_syllables ?? entry.name_default);

  return {
    body: entry.body.replaceAll(NAME_PLACEHOLDER, effectiveName),
    syllableBody: entry.syllable_body?.replaceAll(NAME_PLACEHOLDER, effectiveSyllables),
    personalized: usingTypedName
  };
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
