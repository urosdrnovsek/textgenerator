/**
 * Font/image readiness, page measurement, and the fit result. Renders into
 * a real, off-screen, unscaled surface at the actual print width — never
 * `display:none` (blueprint 8.4 fit procedure).
 */

import { renderWorksheet } from '../render/html.js';
import { getRuling, countFullRows } from './rulings.js';
import { FONT_FAMILIES, contentWidthMm, contentHeightMm, FIT_SAFETY_MM, MIN_COPY_ROWS, COPY_AREA_GAP_MM, pxToMm } from '../config.js';

/**
 * Creates a fresh, isolated off-screen container per call. Concurrent
 * measurements (e.g. two settings changed in quick succession, each
 * triggering its own async measureWorksheet call) must not share one DOM
 * surface — an in-flight older call's second render pass could otherwise
 * overwrite what a newer call is about to read, corrupting its result even
 * though the revision guard elsewhere correctly ignores stale *results*.
 * @returns {HTMLDivElement}
 */
function createMeasureSurface() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
  document.body.append(el);
  return el;
}

/**
 * @param {string} fontFamily
 */
async function waitForFonts(fontFamily) {
  if (!('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`16px "${fontFamily}"`),
    document.fonts.load(`bold 16px "${fontFamily}"`)
  ]);
  await document.fonts.ready;
}

/**
 * @param {HTMLImageElement | null} img
 */
async function waitForImage(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) return;
  if (img.decode) {
    await img.decode().catch(() => {});
    return;
  }
  await new Promise((resolve) => {
    img.addEventListener('load', () => resolve(undefined), { once: true });
    img.addEventListener('error', () => resolve(undefined), { once: true });
  });
}

/**
 * @typedef {object} FitResult
 * @property {boolean} ok
 * @property {number} revision
 * @property {string} [code]
 * @property {object} [details]
 * @property {string[]} [suggestions]
 * @property {{ rowCount: number, ruling: import('./rulings.js').RulingDefinition, contentWidthMm: number }} [layout]
 * @property {Record<string, number>} [heightsMm]
 */

/**
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {number} revision caller-assigned revision id; stale async results
 *   must be discarded by the caller, not by this function
 * @returns {Promise<FitResult>}
 */
export async function measureWorksheet(model, revision) {
  const s = model.settings;
  const widthMm = contentWidthMm(s.marginMm);
  const budgetMm = contentHeightMm(s.marginMm) - FIT_SAFETY_MM;
  const fontFamily = FONT_FAMILIES[s.fontId] ?? s.fontId;
  const ruling = getRuling(s.rulingId, s.guideHeightMm);

  const surface = createMeasureSurface();
  surface.style.width = `${widthMm}mm`;

  try {
    await waitForFonts(fontFamily);

    let page = renderWorksheet(model, { rowCount: 0, ruling, contentWidthMm: widthMm }, surface);
    await waitForImage(page.querySelector('img.ws-image'));

    const usedHeightMm = pxToMm(page.getBoundingClientRect().height);

    if (s.writingMode !== 'read-copy') {
      if (usedHeightMm > budgetMm) {
        return {
          ok: false,
          revision,
          code: 'PAGE_OVERFLOW',
          details: { availableHeightMm: budgetMm, requiredHeightMm: usedHeightMm, overflowMm: usedHeightMm - budgetMm },
          suggestions: ['choose-shorter-text', 'reduce-image']
        };
      }
      return {
        ok: true,
        revision,
        layout: { rowCount: 0, ruling, contentWidthMm: widthMm },
        heightsMm: { used: usedHeightMm, budget: budgetMm }
      };
    }

    const availableForCopyMm = budgetMm - usedHeightMm - COPY_AREA_GAP_MM;
    const rowCount = countFullRows(availableForCopyMm, ruling.lineHeightMm);

    if (rowCount < MIN_COPY_ROWS) {
      const requiredHeightMm = usedHeightMm + COPY_AREA_GAP_MM + MIN_COPY_ROWS * ruling.lineHeightMm;
      return {
        ok: false,
        revision,
        code: 'PAGE_OVERFLOW',
        details: { availableHeightMm: budgetMm, requiredHeightMm, overflowMm: requiredHeightMm - budgetMm },
        suggestions: ['choose-shorter-text', 'reduce-image', 'read-only']
      };
    }

    page = renderWorksheet(model, { rowCount, ruling, contentWidthMm: widthMm }, surface);
    await waitForImage(page.querySelector('img.ws-image'));
    const finalHeightMm = pxToMm(page.getBoundingClientRect().height);

    if (finalHeightMm > budgetMm) {
      return {
        ok: false,
        revision,
        code: 'PAGE_OVERFLOW',
        details: { availableHeightMm: budgetMm, requiredHeightMm: finalHeightMm, overflowMm: finalHeightMm - budgetMm },
        suggestions: ['choose-shorter-text', 'reduce-image', 'read-only']
      };
    }

    return {
      ok: true,
      revision,
      layout: { rowCount, ruling, contentWidthMm: widthMm },
      heightsMm: { used: usedHeightMm, final: finalHeightMm, budget: budgetMm }
    };
  } finally {
    surface.remove();
  }
}
