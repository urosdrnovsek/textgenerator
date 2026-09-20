/**
 * Export readiness and the print surface. Print uses the browser's own
 * pipeline against the same DOM the preview renders — no second layout
 * engine (blueprint 8.5).
 */

/**
 * A worksheet is print-ready whenever it laid out at all — 'fits' (one
 * page) and 'extends' (more than one, clearly labelled) are both allowed
 * to print/export; only 'blocked' is not (upgrade blueprint v3, workstream
 * A reverses the old one-page-only hard block).
 * @param {{ status: 'fits' | 'extends' | 'blocked' } | null | undefined} fitResult
 * @returns {boolean}
 */
export function isPrintReady(fitResult) {
  return Boolean(fitResult && fitResult.status !== 'blocked');
}

/**
 * Triggers the browser's print dialog. The caller must have already
 * rendered a fitting worksheet into the #print-surface element that
 * styles/print.css targets; this function does not render anything itself.
 */
export function printWorksheet() {
  window.print();
}
