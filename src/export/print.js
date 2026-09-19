/**
 * Export readiness and the print surface. Print uses the browser's own
 * pipeline against the same DOM the preview renders — no second layout
 * engine (blueprint 8.5).
 */

/**
 * @param {{ ok: boolean } | null | undefined} fitResult
 * @returns {boolean}
 */
export function isPrintReady(fitResult) {
  return Boolean(fitResult && fitResult.ok);
}

/**
 * Triggers the browser's print dialog. The caller must have already
 * rendered a fitting worksheet into the #print-surface element that
 * styles/print.css targets; this function does not render anything itself.
 */
export function printWorksheet() {
  window.print();
}
