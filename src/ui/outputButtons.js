/**
 * "Print / Save as PDF" and "Export as Word". Both wait for a render in
 * progress: an edited field applies when the click takes the focus away
 * from it, and on a slow PC the sheet can still be measuring when the
 * click lands.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

import { printWorksheet } from '../export/print.js';
import { exportDocx } from '../export/docx.js';
import { sheetLabels } from '../i18n.js';

/**
 * Chromium cancels a download whose object URL is revoked at once.
 */
const REVOKE_DOWNLOAD_URL_AFTER_MS = 4000;

/** @param {string} dataUrl */
function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DOWNLOAD_URL_AFTER_MS);
}

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {() => Promise<void>} ctx.whenRendered
 * @param {(text: string) => void} ctx.showProblem a failure, on the fit line
 */
export function init({ state, els, getT, whenRendered, showProblem }) {
  async function print() {
    await whenRendered();
    if (state.lastGood) printWorksheet();
  }

  async function exportWord() {
    await whenRendered();
    if (!state.lastGood) return;
    const { model, layout } = state.lastGood;
    try {
      const imageBytes = model.image ? dataUrlToBytes(model.image.path) : undefined;
      const blob = await exportDocx(model, layout, imageBytes, sheetLabels(getT()));
      download(blob, `worksheet-${model.contentKey.language}-level-${model.level}.docx`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('DOCX export failed:', error);
      showProblem(getT()('export.failed', { message: error.message }));
    }
  }

  els.printButton.addEventListener('click', print);
  els.docxButton.addEventListener('click', exportWord);
}
