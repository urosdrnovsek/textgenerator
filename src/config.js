/**
 * Single source for page geometry and unit conversions. Internal values are
 * millimetres and points; adapters convert to CSS px or Word twips/half-points
 * at their own boundary (blueprint section 5).
 */

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

export const KNOWN_WRITING_MODES = new Set(['read-copy', 'trace', 'read-only']);
export const KNOWN_SYLLABLE_MODES = new Set(['off', 'colors', 'separators', 'both']);

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

/**
 * Shown only as the name-input placeholder for an entry that has no
 * `name_default` of its own (upgrade blueprint v3, workstream B) — never
 * used as a runtime fallback in src/text/prepare.js. A missing
 * `name_default` on a `{name}` entry is a content validation error, not
 * something this constant silently papers over.
 */
export const DEFAULT_CHILD_NAME = 'Mia';
