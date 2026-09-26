/**
 * Single source for page geometry and unit conversions. Internal values are
 * millimetres and points; adapters convert to CSS px or Word twips/half-points
 * at their own boundary (blueprint section 5).
 */

import { ACTIVITIES } from './worksheet/activities.js';

export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
export const DEFAULT_MARGIN_MM = 20;
/** Rounding/output-difference allowance applied to the vertical fit budget. */
export const FIT_SAFETY_MM = 4;
/** Fewer rows than this makes read-and-copy pointless; treat as insufficient space. */
export const MIN_COPY_ROWS = 3;
/**
 * Fixed gap above the copy-practice area. Single source of truth: the
 * renderer applies this as an inline style (not a CSS rule) so the layout
 * budget in measure.js can never silently drift from what actually renders.
 */
export const COPY_AREA_GAP_MM = 4;
/**
 * Line numbers (settings.lineNumbers) sit in a gutter inside the content
 * box, never in the page margin: the passage is indented by this much in
 * both adapters, so the text rewraps and the fit check measures it.
 */
export const LINE_NUMBER_GUTTER_MM = 8;
/**
 * "Read it, then draw it" (settings.imageSlot 'drawing-box'): a bordered
 * box of fixed height after the passage, with a fixed gap above it. One
 * size on purpose (handbook §11.16: no "fills the page" mode until asked).
 */
export const DRAWING_BOX_HEIGHT_MM = 90;
export const DRAWING_BOX_GAP_MM = 4;

export const MM_PER_INCH = 25.4;
/** CSS reference pixels per inch — a fixed authoring constant, not a display DPI. */
export const CSS_PX_PER_INCH = 96;
export const CSS_PX_PER_MM = CSS_PX_PER_INCH / MM_PER_INCH;
export const PT_PER_INCH = 72;
export const MM_PER_PT = MM_PER_INCH / PT_PER_INCH;
/** OOXML: one point is 20 twips. */
export const TWIPS_PER_PT = 20;
export const TWIPS_PER_INCH = PT_PER_INCH * TWIPS_PER_PT;

/**
 * @param {number} mm
 * @returns {number} OOXML twips
 */
export function mmToTwips(mm) {
  return Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH);
}

/**
 * @param {number} mm
 * @returns {number} CSS pixels (reference pixels, resolution-independent)
 */
export function mmToPx(mm) {
  return mm * CSS_PX_PER_MM;
}

/**
 * @param {number} px
 * @returns {number} millimetres
 */
export function pxToMm(px) {
  return px / CSS_PX_PER_MM;
}

/**
 * @param {number} pt
 * @returns {number} millimetres
 */
export function ptToMm(pt) {
  return pt * MM_PER_PT;
}

export function contentWidthMm(marginMm = DEFAULT_MARGIN_MM) {
  return PAGE_WIDTH_MM - 2 * marginMm;
}

export function contentHeightMm(marginMm = DEFAULT_MARGIN_MM) {
  return PAGE_HEIGHT_MM - 2 * marginMm;
}

/**
 * Maps a stable fontId to the CSS/Word font-family name. All four fonts
 * verified with full glyph coverage for Slovene diacritics (č š ž) before
 * bundling — checked their cmap tables directly, not assumed.
 * @type {Record<string, string>}
 */
export const FONT_FAMILIES = {
  andika: 'Andika',
  lexend: 'Lexend',
  opendyslexic: 'OpenDyslexic',
  comicneue: 'Comic Neue'
};

/**
 * Bounded numeric ranges for WorksheetSettings — the single source both the
 * settings validator and any future settings form must read from, so a
 * form's allowed range and the validator's accepted range can never drift
 * apart (blueprint section 5: "one configuration source for font sizes,
 * permitted spacing, asset limits, and page dimensions").
 */
export const SETTINGS_LIMITS = {
  fontSizePt: { min: 10, max: 32 },
  lineHeightMultiplier: { min: 1, max: 2.5 },
  letterSpacingPt: { min: 0, max: 4 },
  extraWordSpacePt: { min: 0, max: 6 },
  guideHeightMm: { min: 6, max: 20 },
  marginMm: { min: 10, max: 30 }
};

/** One source for the writing modes: the activities table (src/worksheet/activities.js). */
export const KNOWN_WRITING_MODES = new Set(Object.keys(ACTIVITIES));
export const KNOWN_SYLLABLE_MODES = new Set(['off', 'colors', 'separators', 'both']);
/**
 * "Highlight letters" (settings.graphemes, text/graphemes.js). Each group
 * gets the colour at its position, and is bold as well, which is what
 * keeps it visible on a black-and-white printer: four readable hues can't
 * all be 0.05 apart in grey (GRAY_MIN_LUMINANCE_DELTA) without one of them
 * going near-black. Ordered so the first two are far apart in grey
 * (luminance 0.051, 0.142, 0.094, 0.178).
 */
export const GRAPHEME_LIMITS = { maxGroups: 4, maxLength: 4 };
export const GRAPHEME_COLORS = ['#1E3A8A', '#0F766E', '#9A3412', '#DB2777'];

/**
 * Visible word spaces (settings.wordSpaceMarks). The glyph must exist in
 * all four bundled fonts (no fallback font): ␣ ˽ ⸱ fail that check
 * (Instructions/tools/cmap.mjs), and U+00B7 is already the syllable
 * separator, so the owner chose the underscore (2026-09-26).
 */
export const WORD_SPACE_MARK = '_';
export const WORD_SPACE_MARK_COLOR = '#94A3B8';

/** What the sheet's image slot holds: the text's picture, an empty box to draw in, or nothing. */
export const KNOWN_IMAGE_SLOTS = new Set(['picture', 'drawing-box', 'none']);

/**
 * Two marking colours whose relative luminances differ by less than this
 * print as nearly the same grey (worksheet/advice.js GRAY_COLLISION). A
 * starting value (handbook §11.6 B8), to be checked against a real mono
 * laser print; the default b/d pair (0.110 vs 0.097) is well under it.
 */
export const GRAY_MIN_LUMINANCE_DELTA = 0.05;

/**
 * Screen/print background tint (brief section 5: "Tinted background
 * options (cream / soft pastel) instead of pure white, to reduce glare").
 * `printTint` (a separate boolean on WorksheetSettings) controls whether the
 * tint also shows when printed, kept off by default to save ink — matches
 * the printTint/printStripes fields in the blueprint's own example preset
 * (section 6).
 * @type {Record<string, string>}
 */
export const TINTS_BY_ID = {
  none: '#FFFFFF',
  cream: '#FFF8E7',
  blue: '#EAF3FB',
  green: '#EDF7EE'
};
