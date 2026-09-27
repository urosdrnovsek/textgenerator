/**
 * The controls that depend on the writing mode and the text on screen:
 * clicking words in the preview (gaps, or the sentence to copy) and the
 * hint above it, the gap-fill controls, "Show the answers", the teacher's
 * questions, and whether this text can be put in order. All of them write
 * `state.selection`, which belongs to the one text on screen.
 *
 * Takes everything through `ctx` and never imports another ui/* module;
 * it sets up the word picker and the gap controls it coordinates.
 */

import { init as initWordPicker } from './wordPicker.js';
import { init as initClozeControls } from './clozeControls.js';
import { chooseSentence, questionBoxes } from '../worksheet/selection.js';
import { ACTIVITIES } from '../worksheet/activities.js';
import { sequenceLength } from '../worksheet/sequence.js';

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {() => import('../text/tokenize.js').TextDoc | null} ctx.getDoc the text on screen, tokenized
 * @param {() => void} ctx.requestRender
 */
export function init({ state, els, getT, getDoc, requestRender }) {
  const cloze = initClozeControls({ state, els, getT, getDoc, requestRender });

  /**
   * What a clicked word means now: a gap, the sentence to copy, or nothing
   * (and nothing while no sheet is shown).
   * @returns {'gaps' | 'sentence' | null}
   */
  function pickingMode() {
    if (!state.lastGood) return null;
    if (cloze.isPicking()) return 'gaps';
    const copies = ACTIVITIES[state.settings.writingMode]?.copyTarget && state.settings.copyTarget === 'sentence';
    return state.selection && copies ? 'sentence' : null;
  }

  /** @param {number} w */
  function onWord(w) {
    const mode = pickingMode();
    if (mode === 'gaps') cloze.onWord(w);
    if (mode === 'sentence') {
      const word = getDoc()?.words[w];
      if (!word || !state.selection) return;
      state.selection = chooseSentence(state.selection, word.sentence);
      requestRender();
    }
  }
  const picker = initWordPicker({ els, onWord });

  /** @param {Partial<import('../worksheet/selection.js').Selection>} change */
  function changeSelection(change) {
    if (!state.selection) return;
    state.selection = { ...state.selection, ...change };
    requestRender();
  }

  /** Reflects mode, text and selection in the controls; call after every render and mode change. */
  function sync() {
    const t = getT();
    const mode = pickingMode();
    picker.refresh(mode !== null);
    els.previewHint.hidden = mode === null;
    if (mode) els.previewHint.textContent = t(mode === 'gaps' ? 'cloze.hint' : 'copyTarget.hint');
    cloze.sync();
    // Part of the selection: "Add to packet" with it on adds the key as a sheet of its own.
    els.answersRow.hidden = !(state.selection && ACTIVITIES[state.settings.writingMode]?.answers);
    els.showAnswersToggle.checked = Boolean(state.selection?.showAnswers);
    // A new text shows empty question boxes; the box being typed in keeps its text.
    const questions = state.selection?.questions ?? [];
    els.questionInputs.forEach((input, i) => {
      if (document.activeElement !== input) input.value = questions[i] ?? '';
    });
    // "Put in order" needs three sentences: otherwise disabled, with the reason.
    const doc = getDoc();
    const tooFew = doc !== null && sequenceLength(doc.sentences.length) === 0;
    els.sequenceOption.disabled = tooFew;
    els.sequenceOption.textContent = tooFew ? t('writingMode.sequenceTooFew', { count: doc.sentences.length }) : t('writingMode.sequence');
  }

  els.showAnswersToggle.addEventListener('change', () => changeSelection({ showAnswers: els.showAnswersToggle.checked }));
  // One per box as typed: a question in box 3 stays in box 3; empty boxes print nothing.
  for (const input of els.questionInputs) {
    input.addEventListener('change', () => changeSelection({ questions: questionBoxes(els.questionInputs.map((box) => box.value)) }));
  }

  return { sync };
}
