/**
 * "Fill the gaps" controls: toggling a picked word,
 * every Nth word, clearing, the gap count and the refusal past the cap.
 * ("Show the answers" serves every activity with a key; main.js owns it.)
 * Writes exactly one slice of state: `state.selection` (via the pure
 * operations in worksheet/selection.js). Never renders worksheet DOM.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

import { ACTIVITIES } from '../worksheet/activities.js';
import { toggleBlank, blankEveryNth, clearBlanks, maxBlanks } from '../worksheet/selection.js';
import { CLOZE } from '../config.js';

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {() => import('../text/tokenize.js').TextDoc | null} ctx.getDoc the displayed text, tokenized; null before one is shown
 * @param {() => void} ctx.requestRender
 * @returns {{ isPicking: () => boolean, onWord: (w: number) => void, sync: () => void }}
 */
export function init({ state, els, getT, getDoc, requestRender }) {
  /** A refusal stays on screen until the next change that succeeds. */
  let refusal = '';

  /** The selection gaps are picked into, while the sheet is a gap-fill; else null. */
  function pickingSelection() {
    return ACTIVITIES[state.settings.writingMode]?.passage === 'cloze' ? state.selection : null;
  }

  function isPicking() {
    return pickingSelection() !== null;
  }

  function change(selection) {
    refusal = '';
    state.selection = selection;
    requestRender();
  }

  /** @param {number} w a word the teacher clicked or chose by keyboard */
  function onWord(w) {
    const doc = getDoc();
    const selection = pickingSelection();
    if (!selection || !doc) return;
    const result = toggleBlank(selection, w, doc);
    if (!result.ok) {
      refusal = getT()('cloze.tooMany', { max: result.max });
      sync();
      return;
    }
    change(result.selection);
  }

  function everyNth() {
    const doc = getDoc();
    const selection = pickingSelection();
    if (!selection || !doc) return;
    const range = CLOZE.everyNth;
    const n = Math.min(range.max, Math.max(range.min, Math.round(Number(els.clozeEveryNthInput.value) || range.default)));
    els.clozeEveryNthInput.value = String(n); // never show a value that isn't the one applied
    change(blankEveryNth(selection, doc, n));
  }

  function clear() {
    const selection = pickingSelection();
    if (selection) change(clearBlanks(selection));
  }

  /** Reflects mode and selection in the controls; call after every render and mode change. */
  function sync() {
    const t = getT();
    const selection = pickingSelection();
    els.clozeControls.hidden = !selection;
    if (!selection) return;
    const doc = getDoc();
    els.clozeStatus.classList.toggle('is-refused', refusal !== '');
    els.clozeStatus.textContent = refusal || (doc ? t('cloze.count', { count: selection.blanks.length, max: maxBlanks(doc) }) : '');
  }

  els.clozeEveryNthButton.addEventListener('click', everyNth);
  els.clozeClearButton.addEventListener('click', clear);

  return { isPicking, onWord, sync };
}
