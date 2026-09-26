/**
 * Picks words in the preview (handbook §11.3): one delegated listener on
 * #preview reads `data-w` from the clicked span and reports the word
 * index through `ctx.onWord`. It never renders worksheet DOM and never
 * writes state; the caller decides what a picked word means.
 *
 * Keyboard path while picking: the first span of each word takes part in
 * a roving tabindex (one word is tabbable at a time); the arrow keys move
 * between words, Enter or Space picks. Outside picking, nothing in the
 * preview is focusable. The preview is re-rendered after every pick, so
 * `refresh` re-applies the tabindex and puts the focus back on the same
 * word when the pick came from the keyboard.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

/**
 * @param {{ els: { preview: HTMLElement }, onWord: (w: number) => void }} ctx
 * @returns {{ refresh: (active: boolean) => void }}
 */
export function init({ els, onWord }) {
  let active = false;
  /** The word that keeps the tab stop (and gets focus back after a keyboard pick). */
  let currentW = null;
  let restoreFocus = false;

  /** The first span of every word, in reading order (a word may be split into several spans). */
  function wordSpans() {
    const seen = new Set();
    return [...els.preview.querySelectorAll('.ws-sentence [data-w]')].filter((span) => {
      if (seen.has(span.dataset.w)) return false;
      seen.add(span.dataset.w);
      return true;
    });
  }

  function pick(span, fromKeyboard) {
    currentW = Number(span.dataset.w);
    restoreFocus = fromKeyboard;
    onWord(currentW);
  }

  els.preview.addEventListener('click', (event) => {
    if (!active) return;
    const span = event.target.closest('.ws-sentence [data-w]');
    if (span) pick(span, false);
  });

  els.preview.addEventListener('keydown', (event) => {
    if (!active) return;
    const span = event.target.closest?.('.ws-sentence [data-w]');
    if (!span) return;
    const spans = wordSpans();
    const index = spans.findIndex((s) => s.dataset.w === span.dataset.w);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      const next = spans[Math.min(spans.length - 1, Math.max(0, index + step))];
      span.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
      currentW = Number(next.dataset.w);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(span, true);
    }
  });

  /**
   * Call after every render of #preview.
   * @param {boolean} isActive whether words can be picked now
   */
  function refresh(isActive) {
    active = isActive;
    els.preview.classList.toggle('is-picking', active);
    if (!active) {
      currentW = null;
      return;
    }
    const spans = wordSpans();
    if (spans.length === 0) return;
    const current = spans.find((s) => Number(s.dataset.w) === currentW) ?? spans[0];
    for (const span of spans) span.tabIndex = span === current ? 0 : -1;
    if (restoreFocus) {
      current.focus();
      restoreFocus = false;
    }
  }

  return { refresh };
}
