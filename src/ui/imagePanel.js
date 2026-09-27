/**
 * "Custom image": the teacher's own picture for the sheet on screen, for
 * this session only. It replaces only the text's own picture, and goes
 * when another text is shown.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

import { readImageFile } from '../import.js';

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {() => void} ctx.requestRender
 */
export function init({ state, els, getT, requestRender }) {
  /** Back to the text's own picture, without a render: the callers that show another text render anyway. */
  function reset() {
    state.customImage = null;
    els.imageUpload.value = '';
    els.resetImageButton.disabled = true;
    els.imageStatus.textContent = '';
  }

  /** @param {File | undefined} file */
  async function upload(file) {
    if (!file) return;
    const result = await readImageFile(file);
    if (!result.ok) {
      els.imageStatus.textContent = getT()(`image.error.${result.code}`);
      els.imageUpload.value = '';
      return;
    }
    state.customImage = { id: 'custom', path: result.dataUrl, width: result.width, height: result.height };
    els.resetImageButton.disabled = false;
    els.imageStatus.textContent = getT()('image.replaced');
    if (state.contentId) requestRender();
  }

  els.imageUpload.addEventListener('change', () => upload(els.imageUpload.files?.[0]));
  els.resetImageButton.addEventListener('click', () => {
    reset();
    if (state.contentId) requestRender();
  });

  return { reset };
}
