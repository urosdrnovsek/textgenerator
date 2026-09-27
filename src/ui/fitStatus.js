/**
 * The fit line under the Print button and the notices below it, and the
 * grayscale preview, which decides whether GRAY_COLLISION is shown.
 *
 * The fit line's data-* attributes (page count, blocking code, heights in
 * mm) are for the verify-* scripts; the teacher reads the text.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 */
export function init({ state, els, getT }) {
  /** @type {(key: string, vars?: object) => string} */
  const t = (key, vars) => getT()(key, vars);
  const line = els.fitIndicator;

  /** The last sheet's notices, shown again when the grayscale view changes. */
  /** @type {string[]} */
  let noticeCodes = [];
  /** @type {Record<string, Record<string, number>>} */
  let noticeVars = {};

  /**
   * Advisory notices, one line each; they never block printing.
   * GRAY_COLLISION only while the grayscale preview is on: the owner's
   * b/d colours always trigger it, and that is when the teacher is asking
   * how the sheet prints in grey.
   * @param {string[]} codes
   * @param {Record<string, Record<string, number>>} [vars] numbers for a notice's text, by code
   */
  function showNotices(codes, vars = {}) {
    noticeCodes = codes;
    noticeVars = vars;
    const shown = codes.filter((code) => code !== 'GRAY_COLLISION' || state.view.grayscale);
    els.fitNotices.replaceChildren(
      ...shown.map((code) => {
        const li = document.createElement('li');
        li.dataset.notice = code;
        li.textContent = t(`notice.${code}`, vars[code]);
        return li;
      })
    );
    els.fitNotices.hidden = shown.length === 0;
  }

  /**
   * @param {'ok' | 'extends' | 'problem'} look
   * @param {string} text
   * @param {Record<string, string>} [data]
   */
  function setLine(look, text, data = {}) {
    line.classList.toggle('is-overflow', look === 'problem');
    line.classList.toggle('is-extends', look === 'extends');
    Object.assign(line.dataset, { pageCount: '', blockedCode: '', usedMm: '', budgetMm: '', pageCountWithoutMargin: '', ...data });
    line.textContent = text;
  }

  /**
   * One page, several pages, or why it can't be printed.
   * @param {import('../worksheet/build.js').WorksheetModel} model
   * @param {import('../layout/measure.js').FitResult} result
   */
  function showFit(model, result) {
    const suggestions = (result.suggestions ?? []).map((code) => t(`fit.suggestion.${code}`)).join(', ');
    if (result.status === 'blocked') {
      setLine('problem', t('fit.blocked', { reason: t(`fit.blocked.reason.${result.code}`), suggestions }), { blockedCode: result.code });
      showNotices(result.notices);
      return;
    }
    const text = result.status === 'fits'
      ? t('fit.fits', { words: model.wordCount, level: model.level })
      : t('fit.extends', { pages: result.pageCount, words: model.wordCount, level: model.level, suggestions });
    setLine(result.status === 'fits' ? 'ok' : 'extends', text, {
      pageCount: String(result.pageCount),
      usedMm: (result.heightsMm.final ?? result.heightsMm.used).toFixed(1),
      budgetMm: result.heightsMm.budget.toFixed(1),
      pageCountWithoutMargin: String(result.pageCountWithoutMargin ?? '')
    });
    showNotices(result.notices, result.noticeVars);
  }

  /**
   * A message instead of a fit result: "measuring", "choose a text", or a
   * failure (`problem`). Clears the notices.
   * @param {string} text
   * @param {{ problem?: boolean }} [options]
   */
  function showMessage(text, { problem = false } = {}) {
    setLine(problem ? 'problem' : 'ok', text);
    showNotices([]);
  }

  els.grayscalePreviewToggle.addEventListener('change', () => {
    state.view.grayscale = els.grayscalePreviewToggle.checked;
    els.preview.classList.toggle('is-grayscale', state.view.grayscale);
    showNotices(noticeCodes, noticeVars);
  });
  // A reload can restore the checkbox's old state; the view always starts in colour.
  els.grayscalePreviewToggle.checked = state.view.grayscale;

  return { showFit, showMessage };
}
