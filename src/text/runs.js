/**
 * Shared styled-text-run construction: confused-letter coloring and
 * syllable coloring, built once and consumed by both the HTML renderer and
 * the DOCX exporter so the two outputs cannot visually drift apart.
 *
 * Style precedence (blueprint 8.6): confused-letter colors override
 * syllable colors on the same glyph.
 */

/**
 * @typedef {object} StyledRun
 * @property {string} text
 * @property {string} color six-digit hex, e.g. "#B42318"
 * @property {'sep'} [kind] 'sep' marks an inserted syllable-separator mark,
 *   which is not part of the source text — splitRunsIntoSentences must not
 *   count it when cutting runs at source-text offsets
 */

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

/**
 * Merges a stream of (character, color-or-null[, kind]) pairs into runs,
 * filling null with baseColor. Preserves every character exactly. A pair
 * with a kind (an inserted separator) never merges with a pair without
 * one, so the mark stays identifiable as not being source text.
 * @param {Array<[string, string | null, ('sep' | undefined)?]>} pairs
 * @param {string} baseColor
 * @returns {StyledRun[]}
 */
function mergePairsIntoRuns(pairs, baseColor) {
  /** @type {StyledRun[]} */
  const runs = [];
  for (const [text, color, kind] of pairs) {
    const resolved = color ?? baseColor;
    const previous = runs.at(-1);
    if (previous && previous.color === resolved && previous.kind === kind) {
      previous.text += text;
    } else {
      runs.push(kind ? { text, color: resolved, kind } : { text, color: resolved });
    }
  }
  return runs;
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

/**
 * Builds styled runs for plain text (no syllable coloring), applying only
 * confused-letter coloring.
 * @param {string} text
 * @param {StyleOptions} options
 * @returns {StyledRun[]}
 */
export function buildLetterRuns(text, options = {}) {
  const { letterColors = {}, uppercaseAlso = false, baseColor = '#202020' } = options;
  for (const color of Object.values(letterColors)) assertValidColor(color);
  assertValidColor(baseColor);

  /** @type {Array<[string, string | null]>} */
  const pairs = [];
  for (const char of text) {
    pairs.push([char, colorForChar(char, letterColors, uppercaseAlso)]);
  }
  return mergePairsIntoRuns(pairs, baseColor);
}

/**
 * Builds styled runs from a syllable-marked source (`syllable_body`),
 * applying syllable-alternation coloring with confused-letter colors
 * overriding on the same glyph. Alternation resets at each word.
 * @param {string} syllableBody text with `|` between syllables; removing
 *   all `|` must exactly reproduce the entry's `body` (validated upstream)
 * @param {StyleOptions} options
 * @returns {StyledRun[]}
 */
export function buildSyllableRuns(syllableBody, options = {}) {
  const {
    letterColors = {},
    uppercaseAlso = false,
    syllableColors = ['#1D4ED8', '#B45309'],
    separatorColor = '#64748B',
    syllableMode = 'colors',
    baseColor = '#202020'
  } = options;
  for (const color of Object.values(letterColors)) assertValidColor(color);
  for (const color of syllableColors) assertValidColor(color);
  assertValidColor(separatorColor);
  assertValidColor(baseColor);

  const showColors = syllableMode === 'colors' || syllableMode === 'both';
  const showSeparators = syllableMode === 'separators' || syllableMode === 'both';

  /** @type {Array<[string, string | null]>} */
  const pairs = [];
  const tokens = syllableBody.split(/(\s+)/);

  for (const token of tokens) {
    if (token.length === 0) continue;
    if (/^\s+$/.test(token)) {
      for (const char of token) pairs.push([char, null]);
      continue;
    }
    const syllables = token.split('|');
    syllables.forEach((syllable, index) => {
      if (index > 0 && showSeparators) {
        pairs.push([SYLLABLE_SEPARATOR, separatorColor, 'sep']);
      }
      const syllableColor = showColors ? syllableColors[index % syllableColors.length] : null;
      for (const char of syllable) {
        const letterColor = colorForChar(char, letterColors, uppercaseAlso);
        pairs.push([char, letterColor ?? syllableColor]);
      }
    });
  }

  return mergePairsIntoRuns(pairs, baseColor);
}

/**
 * Selects the appropriate run builder for the given settings, choosing
 * syllable coloring only when both requested and available.
 * @param {{ body: string, syllableBody: string | undefined }} resolvedText
 * @param {StyleOptions} options
 * @returns {StyledRun[]}
 */
export function buildStyledRuns(resolvedText, options = {}) {
  const usesSyllables = options.syllableMode && options.syllableMode !== 'off';
  if (usesSyllables && resolvedText.syllableBody) {
    return buildSyllableRuns(resolvedText.syllableBody, options);
  }
  return buildLetterRuns(resolvedText.body, options);
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
      paragraphRuns.push({ text: run.text.slice(offsetInRun, offsetInRun + take), color: run.color });
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
