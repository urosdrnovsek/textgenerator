/**
 * The fit check: how many pages a sheet prints on, and where they break.
 * It renders the sheet off screen, unscaled, at the print width (never
 * display:none, which has no layout), waits for its fonts and picture,
 * and feeds the measured heights to layout/paginate.js, which breaks pages
 * by the same rules as the print CSS (styles/worksheet.css).
 */

import { renderWorksheet, measureBodyLineBoxes } from '../render/html.js';
import { getRuling, countFullRows } from './rulings.js';
import { paginateBlocks } from './paginate.js';
import { advise } from '../worksheet/advice.js';
import { ACTIVITIES } from '../worksheet/activities.js';
import { estimateCopyRows } from './copyEstimate.js';
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
 * A sheet that cannot be printed, and why.
 * @typedef {object} BlockedResult
 * @property {'blocked'} status
 * @property {number} revision
 * @property {'WIDTH_OVERFLOW' | 'BLOCK_TOO_TALL' | 'TOO_FEW_SENTENCES' | 'NO_PICTURE'} code
 * @property {object} details
 * @property {string[]} suggestions
 * @property {string[]} notices always empty
 */

/**
 * A sheet laid out on one page ('fits') or more ('extends'); both print.
 * @typedef {object} LaidOutResult
 * @property {'fits' | 'extends'} status
 * @property {number} revision
 * @property {number} pageCount 1 when status is 'fits'
 * @property {PageLayout} layout
 * @property {Record<string, number>} heightsMm
 * @property {string[]} [suggestions] how to get to one page, when it doesn't fit
 * @property {number} [pageCountWithoutMargin] diagnostic only: the content's page count at the full page height (no FIT_SAFETY_MM); the reported pageCount may exceed it by one, never fall below it
 * @property {string[]} notices advisory codes from worksheet/advice.js
 * @property {Record<string, Record<string, number>>} [noticeVars] numbers a notice's text needs, by code (COPY_SPACE_SHORT: { needed, rows })
 */

/** @typedef {BlockedResult | LaidOutResult} FitResult */

/**
 * WIDTH_OVERFLOW: a word wider than the text column, which no wrapping can
 * break. Checked on the text blocks, not the page: the stripes reach 2 mm
 * past the text on purpose, and must not count.
 * @param {HTMLElement} page
 * @returns {boolean}
 */
function hasHorizontalOverflow(page) {
  // Every element holding shaped text carries .ws-text (render/html.js BLOCK_RENDERERS).
  return [...page.querySelectorAll('.ws-text')].some((el) => el.scrollWidth > el.clientWidth + 1);
}

/**
 * The units a page may break between, in order: each block (`data-block`)
 * is one, except that a passage gives one per line and "Put in order" and
 * the questions one per item.
 *
 * A unit's height is the distance from its top to the next unit's top
 * (the last: to the page's bottom), not its own box height, which leaves
 * out the margins between units.
 * @param {HTMLElement} page
 * @returns {Array<{ heightMm: number }>}
 */
function collectContentBlocks(page) {
  const pageTopPx = page.getBoundingClientRect().top;
  /** @type {number[]} */
  const topsMm = [];
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll(':scope > [data-block]'))) {
    const topMm = pxToMm(el.getBoundingClientRect().top - pageTopPx);
    if (el.dataset.block === 'passage') {
      for (const line of measureBodyLineBoxes(el)) topsMm.push(topMm + line.topMm);
    } else if (el.dataset.block === 'sequence' || el.dataset.block === 'questions') {
      // "Put in order" items and the teacher's questions (with their answer
      // lines): each is a unit (never split), and a page may break between two.
      for (const item of el.children) topsMm.push(pxToMm(item.getBoundingClientRect().top - pageTopPx));
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
 * What to try for one page: a shorter text, then "Picture on the sheet:
 * None" when there is a picture or drawing box that may go (never on
 * "Write about the picture", where None is not offered).
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {string[]} [more] further suggestions, after these
 * @returns {string[]}
 */
function onePageSuggestions(model, more = []) {
  const picture = model.blocks.some((block) => block.type === 'image' || block.type === 'drawingBox');
  const removable = picture && ACTIVITIES[model.settings.writingMode]?.imageSize !== 'large';
  return ['choose-shorter-text', ...(removable ? ['reduce-image'] : []), ...more];
}

/**
 * @param {number} revision
 * @param {BlockedResult['code']} code
 * @param {object} details
 * @param {string[]} suggestions
 * @returns {BlockedResult}
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

  // "Put in order" needs at least SEQUENCE_SENTENCES.min sentences. The UI
  // disables the mode for such a text; a saved setup can still reach it,
  // and then it is blocked, never silently printed as something else.
  const sequence = model.blocks.find((block) => block.type === 'sequence');
  if (sequence && sequence.items.length === 0) {
    return blocked(revision, 'TOO_FEW_SENTENCES', { sentences: sequence.sentenceCount }, ['choose-longer-text']);
  }

  // "Write about the picture" with no picture and no drawing box (an own
  // text without one) would print "Look at the picture" over nothing.
  const needsPicture = ACTIVITIES[s.writingMode]?.imageSize === 'large';
  if (needsPicture && !model.blocks.some((block) => block.type === 'image' || block.type === 'drawingBox')) {
    return blocked(revision, 'NO_PICTURE', {}, ['use-drawing-box', 'choose-other-mode']);
  }

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
        onePageSuggestions(model)
      );
    }

    const totalContentHeightMm = blocks.reduce((sum, b) => sum + b.heightMm, 0);
    const { pageCount, breaksMm, lastPageUsedMm } = paginateBlocks(blocks, budgetMm);
    const pageCountWithoutMargin = paginateBlocks(blocks, budgetMm + FIT_SAFETY_MM).pageCount;

    if (model.task !== 'lines') {
      return {
        status: pageCount === 1 ? 'fits' : 'extends',
        revision,
        pageCount,
        layout: { ruling, contentWidthMm: widthMm, copyBlocks: [], pageBreaksMm: breaksMm },
        heightsMm: { used: totalContentHeightMm, budget: budgetMm },
        suggestions: pageCount === 1 ? undefined : onePageSuggestions(model),
        pageCountWithoutMargin,
        notices: advise(model)
      };
    }

    // Copy lines: as many rows as fit on the last page; if that is fewer
    // than a usable minimum, those rows and then a whole fresh page of
    // them, rather than a cramped handful.
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

    // Rendered again with the copy lines, so the page count comes from the
    // page that will print, not from a calculation.
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
    const copyRows = copyBlocksRows.reduce((sum, rows) => sum + rows, 0);
    const copyRowsNeeded = model.copyTargetText ? estimateCopyRows(model.copyTargetText, s.guideHeightMm, widthMm) : 0;

    return {
      status: finalPageCount === 1 ? 'fits' : 'extends',
      revision,
      pageCount: finalPageCount,
      layout: { ruling, contentWidthMm: widthMm, copyBlocks: copyBlocksRows, pageBreaksMm: [...breaksMm, ...copyBreaksMm] },
      heightsMm: { used: totalContentHeightMm, final: cursorMm, budget: budgetMm },
      suggestions: finalPageCount === 1 ? undefined : onePageSuggestions(model, ['read-only']),
      notices: advise(model, { copyRows, copyRowsNeeded }),
      noticeVars: { COPY_SPACE_SHORT: { needed: copyRowsNeeded, rows: copyRows } }
    };
  } finally {
    surface.remove();
  }
}
