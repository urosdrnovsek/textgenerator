/**
 * Pure pagination over an ordered list of already-measured blocks
 * (upgrade blueprint v3, workstream A). Computes exactly what the print
 * CSS's own page-break rules will do — this module's job is to make that
 * computation explicit ahead of time, not to guess independently of it,
 * so the reported page count and the actual print output can't drift
 * apart (see src/layout/measure.js and the "break-inside: avoid" /
 * "orphans: 1; widows: 1" rules in styles/worksheet.css that keep the two
 * in sync).
 *
 * Every block here is atomic today (a header/title/image wrapper, or one
 * measured body line box) — none of the current content produces a block
 * that would need to split internally. A block taller than the page
 * budget on its own is not something this module resolves; the caller
 * (measure.js) checks for that before pagination and reports it as
 * 'blocked' rather than silently producing an overflowing page.
 */

/**
 * @typedef {object} LayoutBlock
 * @property {number} heightMm
 * @property {boolean} [atomic] reserved for a future block type that could
 *   split across a page; every block today is implicitly atomic
 */

/**
 * @typedef {object} PaginationResult
 * @property {number} pageCount
 * @property {number[]} breaksMm cumulative height (from the top of the
 *   whole flowed document, across all pages) at each point a new page
 *   starts — one entry per page after the first
 * @property {number} lastPageUsedMm height used on the final page
 */

/**
 * @param {LayoutBlock[]} blocks in document order
 * @param {number} pageBudgetMm
 * @returns {PaginationResult}
 */
export function paginateBlocks(blocks, pageBudgetMm) {
  let pageCount = 1;
  let usedOnPage = 0;
  let totalHeightMm = 0;
  /** @type {number[]} */
  const breaksMm = [];

  for (const block of blocks) {
    if (usedOnPage > 0 && usedOnPage + block.heightMm > pageBudgetMm) {
      breaksMm.push(totalHeightMm);
      pageCount += 1;
      usedOnPage = 0;
    }
    usedOnPage += block.heightMm;
    totalHeightMm += block.heightMm;
  }

  return { pageCount, breaksMm, lastPageUsedMm: usedOnPage };
}
