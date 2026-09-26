/**
 * "Fill the gaps" controls (handbook §11.6 A1): toggling a picked word,
 * every Nth word, clearing, the gap count and the refusal past the cap,
 * and "Show the answers" for the answer key (part of the selection, so
 * "Add to packet" with it on puts the key next to the student sheet).
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
 * @param {object} ctx.state
 * @param {Record<string, HTMLElement>} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {() => import('../text/tokenize.js').TextDoc | null} ctx.getDoc the displayed text, tokenized; null before one is shown
 * @param {() => void} ctx.requestRender
 * @returns {{ isPicking: () => boolean, onWord: (w: number) => void, sync: () => void }}
 */
export function init({ state, els, getT, getDoc, requestRender }) {
  /** A refusal stays on screen until the next change that succeeds. */
  let refusal = '';

  function isPicking() {
    return ACTIVITIES[state.settings.writingMode]?.passage === 'cloze' && Boolean(state.selection);
  }

  function change(selection) {
    refusal = '';
    state.selection = selection;
    requestRender();
  }

  /** @param {number} w a word the teacher clicked or chose by keyboard */
  function onWord(w) {
    const doc = getDoc();
    if (!isPicking() || !doc) return;
    const result = toggleBlank(state.selection, w, doc);
    if (!result.ok) {
      refusal = getT()('cloze.tooMany', { max: result.max });
      sync();
      return;
    }
    change(result.selection);
  }

  function everyNth() {
    const doc = getDoc();
    if (!isPicking() || !doc) return;
    const range = CLOZE.everyNth;
    const n = Math.min(range.max, Math.max(range.min, Math.round(Number(els.clozeEveryNthInput.value) || range.default)));
    els.clozeEveryNthInput.value = String(n); // never show a value that isn't the one applied
    change(blankEveryNth(state.selection, doc, n));
  }

  function clear() {
    if (!isPicking()) return;
    change(clearBlanks(state.selection));
  }

  function showAnswers(enabled) {
    if (!isPicking()) return;
    change({ ...state.selection, showAnswers: enabled });
  }

  /** Reflects mode and selection in the controls; call after every render and mode change. */
  function sync() {
    const t = getT();
    const picking = isPicking();
    els.clozeControls.hidden = !picking;
    els.previewHint.hidden = !picking;
    if (!picking) return;
    els.previewHint.textContent = t('cloze.hint');
    els.clozeShowAnswersToggle.checked = state.selection.showAnswers;
    const doc = getDoc();
    els.clozeStatus.classList.toggle('is-refused', refusal !== '');
    els.clozeStatus.textContent = refusal || (doc ? t('cloze.count', { count: state.selection.blanks.length, max: maxBlanks(doc) }) : '');
  }

  els.clozeEveryNthButton.addEventListener('click', everyNth);
  els.clozeClearButton.addEventListener('click', clear);
  els.clozeShowAnswersToggle.addEventListener('change', (e) => showAnswers(e.target.checked));

  return { isPicking, onWord, sync };
}
