/**
 * How many handwriting rows a copy target needs (handbook §11.6 A3). A
 * heuristic, and shown as one ("About N lines"): a child's handwritten
 * character is taken to be HANDWRITING_CHAR_WIDTH_RATIO of the guide
 * height wide. The layout never adds pages to match it — the teacher
 * decides. Pure.
 */

import { HANDWRITING_CHAR_WIDTH_RATIO } from '../config.js';

/**
 * @param {string} text what the child copies (spaces count: they take room too)
 * @param {number} guideHeightMm settings.guideHeightMm
 * @param {number} contentWidthMm
 * @returns {number} rows
 */
export function estimateCopyRows(text, guideHeightMm, contentWidthMm) {
  const charsPerRow = Math.max(1, Math.floor(contentWidthMm / (guideHeightMm * HANDWRITING_CHAR_WIDTH_RATIO)));
  return Math.ceil(text.trim().length / charsPerRow);
}
