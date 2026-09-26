/**
 * Shared styled-text-run construction: confused-letter coloring and
 * syllable coloring, built once and consumed by both the HTML renderer and
 * the DOCX exporter so the two outputs cannot visually drift apart.
 *
 * One function decides every glyph's style (styleText, upgrade blueprint
 * §11.5.2); before 0.10 there were two builders (plain letters and
 * syllables) with the precedence written out twice. Precedence, highest
 * first: confused-letter colour > alternating syllable colour > base.
 *
 * Runs carry metadata so later features can address words and syllables
 * (click targets, arcs): a run never crosses a word or syllable boundary.
 */

import { tokenize, wordIndexByOffset } from './tokenize.js';

/**
 * @typedef {object} StyledRun
 * @property {string} text
 * @property {string} color six-digit hex, e.g. "#B42318"
 * @property {number} [w] index of the word this run belongs to (src/text/tokenize.js); present on every run inside a word, including a separator mark inside it
 * @property {number} [syl] syllable index within the word; present on word letters when the text has syllable data
 * @property {'space' | 'punct' | 'sep'} [kind] absent = letters of a word.
 *   'sep' marks an inserted syllable-separator mark, which is not part of
 *   the source text — splitRunsIntoSentences must not count it when
 *   cutting runs at source-text offsets
 */

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** The two alternating syllable colours when settings give none. */
export const DEFAULT_SYLLABLE_COLORS = ['#1D4ED8', '#B45309'];

/**
 * @param {string} color
 */
function assertValidColor(color) {
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new Error(`invalid color "${color}": expected a six-digit hex value`);
  }
}

/**
 * @param {string} char single character (code point)
 * @param {Record<string, string>} letterColors lowercase letter -> hex color
 * @param {boolean} uppercaseAlso
 * @returns {string | null}
 */
function colorForChar(char, letterColors, uppercaseAlso) {
  const lower = char.toLowerCase();
  if (!Object.hasOwn(letterColors, lower)) {
    return null;
  }
  const isUpper = char !== lower && char === char.toUpperCase();
  if (isUpper && !uppercaseAlso) {
    return null;
  }
  return letterColors[lower];
}

/** Between-syllable mark for 'separators'/'both' mode (blueprint brief section 5: "separating words into syllables and/or alternating syllable colors" — both are independently available, not either/or). */
const SYLLABLE_SEPARATOR = '·'; // middle dot

/**
 * @typedef {object} StyleOptions
 * @property {Record<string, string>} [letterColors] lowercase letter -> hex color, e.g. { b: '#B42318', d: '#166534' }
 * @property {boolean} [uppercaseAlso] apply letterColors to uppercase too (default false)
 * @property {[string, string]} [syllableColors] two hex colors to alternate across syllables
 * @property {string} [separatorColor] color of the middle-dot mark in 'separators'/'both' mode
 * @property {'off' | 'colors' | 'separators' | 'both'} [syllableMode]
 * @property {string} [baseColor]
 */

/** Two styled pieces merge into one run only when everything a consumer may read from them is equal. */
function sameStyle(a, b) {
  return a.color === b.color && a.kind === b.kind && a.w === b.w && a.syl === b.syl;
}

/**
 * The single styling function: every glyph's colour and every run's
 * metadata are decided here, nowhere else.
 *
 * Syllable alternation counts syllables per whitespace-separated token
 * (so trailing punctuation takes the colour of the last syllable, "ny,"),
 * exactly as the pre-0.10 builders did; the golden test
 * (tests/unit/golden-runs.test.js) holds this function to that output.
 * @param {import('./tokenize.js').TextDoc} doc
 * @param {StyleOptions} options
 * @returns {StyledRun[]}
 */
export function styleText(doc, options = {}) {
  const {
    letterColors = {},
    uppercaseAlso = false,
    syllableColors = DEFAULT_SYLLABLE_COLORS,
    separatorColor = '#64748B',
    syllableMode = 'off',
    baseColor = '#202020'
  } = options;
  for (const color of Object.values(letterColors)) assertValidColor(color);
  for (const color of syllableColors) assertValidColor(color);
  assertValidColor(separatorColor);
  assertValidColor(baseColor);

  const { body, words, syllableBreaks, hasSyllables } = doc;
  const usesSyllables = hasSyllables && syllableMode !== 'off';
  const showColors = usesSyllables && (syllableMode === 'colors' || syllableMode === 'both');
  const showSeparators = usesSyllables && (syllableMode === 'separators' || syllableMode === 'both');
  const wordAt = wordIndexByOffset(doc);
  const isSpace = (char) => /\s/.test(char);

  /** @type {StyledRun[]} */
  const runs = [];
  const push = (piece) => {
    const previous = runs.at(-1);
    if (previous && sameStyle(previous, piece)) previous.text += piece.text;
    else runs.push(piece);
  };
  const separatorAt = (offset) => {
    const piece = { text: SYLLABLE_SEPARATOR, color: separatorColor, kind: 'sep' };
    const w = offset < body.length ? wordAt[offset] : -1;
    if (w >= 0 && offset > words[w].start) piece.w = w;
    push(piece);
  };

  let nextBreak = 0; // index into syllableBreaks
  let tokenSyllable = 0; // syllable index within the current whitespace token
  let offset = 0;
  while (offset < body.length) {
    const char = String.fromCodePoint(body.codePointAt(offset));
    const space = isSpace(char);
    if (space) tokenSyllable = 0;

    // Every break at this offset: advances the token's syllable count, and
    // draws a separator when it sits inside or at the edge of a token.
    while (nextBreak < syllableBreaks.length && syllableBreaks[nextBreak] === offset) {
      const touchesToken = !space || (offset > 0 && !isSpace(body[offset - 1]));
      if (showSeparators && touchesToken) separatorAt(offset);
      if (!space) tokenSyllable += 1;
      nextBreak += 1;
    }

    /** @type {StyledRun} */
    const piece = { text: char, color: baseColor };
    const w = wordAt[offset];
    if (space) {
      piece.kind = 'space';
    } else {
      piece.color = colorForChar(char, letterColors, uppercaseAlso)
        ?? (showColors ? syllableColors[tokenSyllable % syllableColors.length] : baseColor);
      if (w >= 0) {
        piece.w = w;
        if (hasSyllables) {
          const starts = words[w].syllableStarts;
          let syl = 0;
          while (syl + 1 < starts.length && starts[syl + 1] <= offset) syl++;
          piece.syl = syl;
        }
      } else {
        piece.kind = 'punct';
      }
    }
    push(piece);
    offset += char.length;
  }
  // A break at the very end of the text (a trailing `|`).
  while (nextBreak < syllableBreaks.length && syllableBreaks[nextBreak] === body.length) {
    if (showSeparators && body.length > 0 && !isSpace(body[body.length - 1])) separatorAt(body.length);
    nextBreak += 1;
  }
  return runs;
}

/**
 * Styles an entry's text for the worksheet: tokenizes it and applies
 * styleText. Syllable styling applies only when requested and the text has
 * syllable data.
 * @param {{ body: string, syllableBody: string | undefined }} resolvedText
 * @param {StyleOptions} options
 * @returns {StyledRun[]}
 */
export function buildStyledRuns(resolvedText, options = {}) {
  return styleText(tokenize({ body: resolvedText.body, syllable_body: resolvedText.syllableBody }), options);
}

/**
 * Splits one flat run array into one run array per sentence, for
 * "one sentence per line" (blueprint brief section 5). Cuts the already-
 * built runs at sentence-boundary character offsets rather than re-deriving
 * styling per sentence, so styling (syllable alternation, letter-color
 * precedence) stays computed exactly once on the full text — the same
 * shared-runs principle as the rest of this module (blueprint 8.6/8.9).
 * @param {StyledRun[]} runs flat runs whose concatenated text exactly equals the source of `sentences`
 * @param {string[]} sentences from splitIntoSentences(sourceText) — trimmed, whitespace-joined approximation of sourceText
 * @returns {StyledRun[][]}
 */
export function splitRunsIntoSentences(runs, sentences) {
  const paragraphs = [];
  let runIndex = 0;
  let offsetInRun = 0;

  const isWhitespace = (char) => char !== undefined && /\s/.test(char);

  for (const sentence of sentences) {
    /** @type {StyledRun[]} */
    const paragraphRuns = [];
    let remaining = sentence.length;
    while (remaining > 0 && runIndex < runs.length) {
      const run = runs[runIndex];
      if (run.kind === 'sep') {
        // An inserted syllable mark is not in the source text, so it
        // consumes none of the sentence's length. Counting it (before
        // 0.10) cut every sentence short with separators on and dropped
        // the passage's last characters entirely.
        paragraphRuns.push(run);
        runIndex++;
        offsetInRun = 0;
        continue;
      }
      const availableInRun = run.text.length - offsetInRun;
      const take = Math.min(remaining, availableInRun);
      paragraphRuns.push({ ...run, text: run.text.slice(offsetInRun, offsetInRun + take) });
      offsetInRun += take;
      remaining -= take;
      if (offsetInRun >= run.text.length) {
        runIndex++;
        offsetInRun = 0;
      }
    }
    paragraphs.push(paragraphRuns);

    // Skip the whitespace/newline between this sentence and the next —
    // splitIntoSentences trimmed it out, so it isn't part of any sentence.
    while (runIndex < runs.length && isWhitespace(runs[runIndex].text[offsetInRun])) {
      offsetInRun++;
      if (offsetInRun >= runs[runIndex].text.length) {
        runIndex++;
        offsetInRun = 0;
      }
    }
  }

  return paragraphs;
}

/**
 * @param {string} hexColor
 * @param {number} amount 0 (unchanged) to 1 (white)
 * @returns {string}
 */
function lightenColor(hexColor, amount) {
  const channel = (start) => parseInt(hexColor.slice(start, start + 2), 16);
  const mix = (value) => Math.round(value + (255 - value) * amount);
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(mix(channel(1)))}${toHex(mix(channel(3)))}${toHex(mix(channel(5)))}`.toUpperCase();
}

/**
 * Produces a lightened copy of styled paragraphs for trace mode — keeps
 * every color (letter, syllable, separator) distinguishable but light
 * enough to trace over (blueprint 8.6: "explicit lighter variants while
 * preserving b/d/p/q distinction"). Same shared-runs data flows to both
 * HTML and DOCX, so the two can't render trace mode differently.
 * @param {StyledRun[][]} paragraphs
 * @param {number} [amount]
 * @returns {StyledRun[][]}
 */
export function lightenParagraphs(paragraphs, amount = 0.65) {
  return paragraphs.map((runs) => runs.map((run) => ({ ...run, color: lightenColor(run.color, amount) })));
}

/**
 * Counts words in already-resolved (syllable-marker-free) text using
 * Intl.Segmenter when available, falling back to whitespace splitting.
 * @param {string} text
 * @param {string} [locale]
 * @returns {number}
 */
export function countWords(text, locale = 'en') {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    let count = 0;
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) count++;
    }
    return count;
  }
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}
