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
 * Maps a stable fontId to the CSS/Word font-family name. Phase 0 bundles
 * only Andika; Lexend/OpenDyslexic/Comic Neue are added in Phase 4.
 * @type {Record<string, string>}
 */
export const FONT_FAMILIES = {
  andika: 'Andika'
};
