/**
 * Image slot geometry — one source of truth for the worksheet image's
 * bounding box, shared by the HTML/print CSS and the DOCX exporter, so a
 * bundled/custom/imported image is never stretched off its real aspect
 * ratio in one output while fitting correctly in the other (upgrade
 * blueprint v3, workstream D1). Pure, no DOM.
 */

export const IMAGE_BOX_MAX_WIDTH_MM = 60;
export const IMAGE_BOX_MAX_HEIGHT_MM = 45;

/**
 * Mirrors CSS `object-fit: contain` against the box above: scales the
 * source to the largest size that fits within the box while preserving its
 * aspect ratio (may scale up or down).
 * @param {number | undefined} naturalWidth source pixel width
 * @param {number | undefined} naturalHeight source pixel height
 * @param {number} [maxWidthMm]
 * @param {number} [maxHeightMm]
 * @returns {{ widthMm: number, heightMm: number }} falls back to the full
 *   box (the old fixed behavior) when the source has no known dimensions
 */
export function computeContainedImageSizeMm(
  naturalWidth,
  naturalHeight,
  maxWidthMm = IMAGE_BOX_MAX_WIDTH_MM,
  maxHeightMm = IMAGE_BOX_MAX_HEIGHT_MM
) {
  if (!naturalWidth || !naturalHeight) {
    return { widthMm: maxWidthMm, heightMm: maxHeightMm };
  }
  const scale = Math.min(maxWidthMm / naturalWidth, maxHeightMm / naturalHeight);
  return { widthMm: naturalWidth * scale, heightMm: naturalHeight * scale };
}
