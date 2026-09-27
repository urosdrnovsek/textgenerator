/**
 * Printing is the browser's own, of the same DOM the preview shows: there
 * is no second layout engine.
 */

/**
 * A sheet prints (and exports) whenever it was laid out, on one page or
 * more; only a blocked one does not.
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
