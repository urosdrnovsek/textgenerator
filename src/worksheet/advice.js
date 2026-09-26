/**
 * Advisory notices: things the teacher should know about a printable
 * sheet (handbook §11.11, "Advisory"). Pure: model in, notice codes out.
 * The codes are localized at the UI edge as `notice.<CODE>`.
 *
 * Notices never block and never change the layout — a sheet that cannot
 * be laid out is a 'blocked' FitResult (layout/measure.js), not a notice.
 */

import { GRAY_MIN_LUMINANCE_DELTA } from '../config.js';
import { DEFAULT_SYLLABLE_COLORS } from '../text/runs.js';

/** Every code advise() can return; each needs a `notice.<CODE>` string in all five locales. */
export const NOTICE_CODES = ['GRAY_COLLISION'];

/**
 * WCAG relative luminance of a six-digit hex colour.
 * @param {string} hex e.g. "#B42318"
 * @returns {number} 0 (black) … 1 (white)
 */
export function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * True when two colours of one group print as nearly the same grey.
 * @param {string[]} colors
 */
function hasGrayCollision(colors) {
  const lums = [...new Set(colors.map((c) => c.toUpperCase()))].map(relativeLuminance);
  return lums.some((a, i) => lums.slice(i + 1).some((b) => Math.abs(a - b) < GRAY_MIN_LUMINANCE_DELTA));
}

/**
 * GRAY_COLLISION compares the colours the sheet uses *to tell things
 * apart*: the letter colours and the highlighted letter groups' colours
 * as one group (they sit side by side in the same words), and the two syllable
 * colours when they print (colours mode on and the text has syllable
 * data). Identical colours in one group are not a collision — they were
 * never meant to be told apart.
 * @param {import('./build.js').WorksheetModel} model
 */
function grayCollision(model) {
  const s = model.settings;
  const letterColors = Object.values(s.letterColors ?? {});
  const groupColors = (s.graphemes ?? []).map((g) => g.color);
  if (hasGrayCollision([...letterColors, ...groupColors])) return true;
  const syllableColorsShown = (s.syllableMode === 'colors' || s.syllableMode === 'both')
    && model.bodyParagraphs.some((runs) => runs.some((run) => run.syl !== undefined));
  return syllableColorsShown && hasGrayCollision(s.syllableColors ?? DEFAULT_SYLLABLE_COLORS);
}

/**
 * @param {import('./build.js').WorksheetModel} model
 * @returns {string[]} notice codes, in display order; empty when there is nothing to say
 */
export function advise(model) {
  /** @type {string[]} */
  const notices = [];
  if (grayCollision(model)) notices.push('GRAY_COLLISION');
  return notices;
}
