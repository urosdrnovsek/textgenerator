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
 * Merges a stream of (character, color-or-null) pairs into runs, filling
 * null with baseColor. Preserves every character exactly.
 * @param {Array<[string, string | null]>} pairs
 * @param {string} baseColor
 * @returns {StyledRun[]}
 */
function mergePairsIntoRuns(pairs, baseColor) {
  /** @type {StyledRun[]} */
  const runs = [];
  for (const [text, color] of pairs) {
    const resolved = color ?? baseColor;
    const previous = runs.at(-1);
    if (previous && previous.color === resolved) {
      previous.text += text;
    } else {
      runs.push({ text, color: resolved });
    }
  }
  return runs;
}

/**
 * @typedef {object} StyleOptions
 * @property {Record<string, string>} [letterColors] lowercase letter -> hex color, e.g. { b: '#B42318', d: '#166534' }
 * @property {boolean} [uppercaseAlso] apply letterColors to uppercase too (default false)
 * @property {[string, string]} [syllableColors] two hex colors to alternate across syllables
 * @property {'off' | 'colors'} [syllableMode]
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
    baseColor = '#202020'
  } = options;
  for (const color of Object.values(letterColors)) assertValidColor(color);
  for (const color of syllableColors) assertValidColor(color);
  assertValidColor(baseColor);

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
      const syllableColor = syllableColors[index % syllableColors.length];
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
  if (options.syllableMode === 'colors' && resolvedText.syllableBody) {
    return buildSyllableRuns(resolvedText.syllableBody, options);
  }
  return buildLetterRuns(resolvedText.body, options);
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
