/**
 * Font/image readiness, page measurement, and the fit result. Renders into
 * a real, off-screen, unscaled surface at the actual print width — never
 * `display:none` (blueprint 8.4 fit procedure).
 *
 * A worksheet may now print on more than one page (upgrade blueprint v3,
 * workstream A — the old hard one-page block is gone). This module's job
 * is to compute exactly how many pages, and where the breaks fall, by
 * feeding real measured block heights into layout/paginate.js — the same
 * computation the print CSS's own break rules perform, so the reported
 * page count can't drift from what actually prints (see
 * styles/worksheet.css's break-inside/orphans/widows rules).
 */

import { renderWorksheet, measureBodyLineBoxes } from '../render/html.js';
import { getRuling, countFullRows } from './rulings.js';
import { paginateBlocks } from './paginate.js';
import { advise } from '../worksheet/advice.js';
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
 * @typedef {object} PageLayout
 * @property {import('./rulings.js').RulingDefinition} ruling
 * @property {number} contentWidthMm
 * @property {number[]} copyBlocks rows per copy-practice block; empty unless the model's task is 'lines'
 * @property {number[]} pageBreaksMm cumulative height (mm, from the top of the flowed page content) at each point a new page starts
 */

/**
 * @typedef {object} FitResult
 * @property {'fits' | 'extends' | 'blocked'} status
 * @property {number} revision
 * @property {number} [pageCount] present unless 'blocked'; 1 when status is 'fits'
 * @property {PageLayout} [layout] present unless 'blocked'
 * @property {string} [code] 'blocked' only: 'WIDTH_OVERFLOW' | 'BLOCK_TOO_TALL'
 * @property {object} [details]
 * @property {string[]} [suggestions]
 * @property {Record<string, number>} [heightsMm]
 * @property {string[]} notices advisory codes from worksheet/advice.js; always empty when 'blocked'
 */

/**
 * WIDTH_OVERFLOW means "a word wider than the content width" — normal
 * wrapping cannot break it, so it overflows its own text box. Checked on
 * the text blocks, not the page's scrollWidth: decorative overlays are
 * allowed to bleed past the body box (the line stripes extend 2mm either
 * side on purpose), and a page-wide check mistook that bleed for an
 * unbreakable word, blocking every worksheet with stripes on from 0.8
 * (cf502b9) until 0.8.1.
 * @param {HTMLElement} page
 * @returns {boolean}
 */
function hasHorizontalOverflow(page) {
  // Every element holding shaped text carries .ws-text (render/html.js BLOCK_RENDERERS).
  return [...page.querySelectorAll('.ws-text')].some((el) => el.scrollWidth > el.clientWidth + 1);
}

/**
 * Collects the atomic layout units above the copy area, in document order,
 * from an already-rendered, already-attached page: every model block
 * (`[data-block]`, see render/html.js) is one unit, except a passage,
 * which contributes one unit per real measured line box (it may break
 * between lines).
 *
 * Each block's heightMm is derived from the gap between its own top and
 * the next block's top (or the page's own bottom, for the last block) —
 * not from the block's own border-box height. getBoundingClientRect()
 * excludes margins, so summing individual heights would silently drop any
 * margin between blocks (found the hard way: sentence-per-line's
 * `.ws-sentence { margin-bottom: 0.25em }` between paragraphs disappeared
 * this way, undercounting total height and reporting 'fits' for content
 * that, once printed, actually needed a second page). Measuring the real
 * top-to-top distance between successive elements captures whatever
 * margin sits between them, whatever it is, the same way the single
 * whole-page measurement this replaced always did.
 * @param {HTMLElement} page
 * @returns {Array<{ heightMm: number }>}
 */
function collectContentBlocks(page) {
  const pageTopPx = page.getBoundingClientRect().top;
  /** @type {number[]} */
  const topsMm = [];
  for (const el of page.querySelectorAll(':scope > [data-block]')) {
    const topMm = pxToMm(el.getBoundingClientRect().top - pageTopPx);
    if (el.dataset.block === 'passage') {
      for (const line of measureBodyLineBoxes(el)) topsMm.push(topMm + line.topMm);
    } else {
      topsMm.push(topMm);
    }
  }
  const pageBottomMm = pxToMm(page.getBoundingClientRect().height);
  return topsMm.map((topMm, i) => ({
    heightMm: (i + 1 < topsMm.length ? topsMm[i + 1] : pageBottomMm) - topMm
  }));
}

/**
 * @param {number} revision
 * @param {string} code
 * @param {object} details
 * @param {string[]} suggestions
 * @returns {FitResult}
 */
function blocked(revision, code, details, suggestions) {
  return { status: 'blocked', revision, code, details, suggestions, notices: [] };
}

/**
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {number} revision caller-assigned revision id; stale async results
 *   must be discarded by the caller, not by this function
 * @param {object} [labels] i18n.sheetLabels — measured in the sheet's own
 *   language, so a longer instruction line is measured as it will print
 * @returns {Promise<FitResult>}
 */
export async function measureWorksheet(model, revision, labels) {
  const s = model.settings;
  const widthMm = contentWidthMm(s.marginMm);
  const budgetMm = contentHeightMm(s.marginMm) - FIT_SAFETY_MM;
  const fontFamily = FONT_FAMILIES[s.fontId] ?? s.fontId;
  const ruling = getRuling(s.rulingId, s.guideHeightMm);

  const surface = createMeasureSurface();
  surface.style.width = `${widthMm}mm`;

  try {
    await waitForFonts(fontFamily);

    const page = renderWorksheet(model, { copyBlocks: [], ruling, contentWidthMm: widthMm }, surface, labels);
    await waitForImage(page.querySelector('img.ws-image'));

    if (hasHorizontalOverflow(page)) {
      return blocked(
        revision,
        'WIDTH_OVERFLOW',
        { contentWidthMm: widthMm },
        ['choose-shorter-text']
      );
    }

    const blocks = collectContentBlocks(page);
    const tooTall = blocks.find((b) => b.heightMm > budgetMm);
    if (tooTall) {
      return blocked(
        revision,
        'BLOCK_TOO_TALL',
        { availableHeightMm: budgetMm, requiredHeightMm: tooTall.heightMm },
        ['choose-shorter-text', 'reduce-image']
      );
    }

    const totalContentHeightMm = blocks.reduce((sum, b) => sum + b.heightMm, 0);
    const { pageCount, breaksMm, lastPageUsedMm } = paginateBlocks(blocks, budgetMm);

    if (model.task !== 'lines') {
      return {
        status: pageCount === 1 ? 'fits' : 'extends',
        revision,
        pageCount,
        layout: { ruling, contentWidthMm: widthMm, copyBlocks: [], pageBreaksMm: breaksMm },
        heightsMm: { used: totalContentHeightMm, budget: budgetMm },
        suggestions: pageCount === 1 ? undefined : ['choose-shorter-text', 'reduce-image'],
        notices: advise(model)
      };
    }

    // Read-and-copy: fit as many copy rows as remain on the last content
    // page; if fewer than a usable minimum remain, finish that page with
    // whatever fits (may be zero rows) and give the copy exercise one full
    // fresh page rather than a cramped handful of lines (blueprint 8.4:
    // "do not imply five blank lines are enough for 200 handwritten
    // words" — applied honestly via an extra page instead of blocking).
    const remainderMm = budgetMm - lastPageUsedMm - COPY_AREA_GAP_MM;
    const rowsOnLastPage = countFullRows(remainderMm, ruling.lineHeightMm);

    let lastPageRows = rowsOnLastPage;
    let freshPageRows = 0;
    let extraPage = false;

    if (rowsOnLastPage < MIN_COPY_ROWS) {
      freshPageRows = countFullRows(budgetMm, ruling.lineHeightMm);
      if (freshPageRows < MIN_COPY_ROWS) {
        // Not even a completely empty page can fit the minimum — the
        // configured guide height is too tall for this page budget, a
        // genuinely impossible request rather than one more page can fix.
        return blocked(
          revision,
          'BLOCK_TOO_TALL',
          { availableHeightMm: budgetMm, requiredHeightMm: MIN_COPY_ROWS * ruling.lineHeightMm },
          ['read-only']
        );
      }
      extraPage = true;
    }

    const copyBlocksRows = [lastPageRows, freshPageRows].filter((n) => n > 0);

    // Real second render pass with the actual final copy blocks, so the
    // reported page count and break positions come from the DOM that will
    // actually print, not a re-derivation of it (blueprint 8.4 fit
    // procedure's own rule, applied to the added copy-area geometry).
    const finalPage = renderWorksheet(model, { copyBlocks: copyBlocksRows, ruling, contentWidthMm: widthMm }, surface, labels);
    await waitForImage(finalPage.querySelector('img.ws-image'));
    const measuredCopyBlockHeightsMm = [...finalPage.querySelectorAll('.ws-copy-block')].map((el) =>
      pxToMm(el.getBoundingClientRect().height)
    );

    let cursorMm = totalContentHeightMm;
    const copyBreaksMm = [];
    let measuredIndex = 0;
    if (lastPageRows > 0) {
      cursorMm += measuredCopyBlockHeightsMm[measuredIndex];
      measuredIndex += 1;
    }
    if (extraPage) {
      copyBreaksMm.push(cursorMm);
      if (freshPageRows > 0) {
        cursorMm += measuredCopyBlockHeightsMm[measuredIndex];
      }
    }

    const finalPageCount = pageCount + (extraPage ? 1 : 0);

    return {
      status: finalPageCount === 1 ? 'fits' : 'extends',
      revision,
      pageCount: finalPageCount,
      layout: { ruling, contentWidthMm: widthMm, copyBlocks: copyBlocksRows, pageBreaksMm: [...breaksMm, ...copyBreaksMm] },
      heightsMm: { used: totalContentHeightMm, final: cursorMm, budget: budgetMm },
      suggestions: finalPageCount === 1 ? undefined : ['choose-shorter-text', 'reduce-image', 'read-only'],
      notices: advise(model)
    };
  } finally {
    surface.remove();
  }
}
