/**
 * Builds safe DOM nodes for screen preview and print from the shared
 * worksheet model. Never re-implements letter/syllable coloring — it only
 * renders the StyledRun[] it is given. Text always enters through
 * textContent, never innerHTML (blueprint 8.6).
 */

import { buildRulingRows } from '../layout/rulings.js';
import { ptToMm, pxToMm, FONT_FAMILIES, COPY_AREA_GAP_MM, TINTS_BY_ID } from '../config.js';
import { IMAGE_BOX_MAX_WIDTH_MM, IMAGE_BOX_MAX_HEIGHT_MM } from '../layout/imageBox.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {{ nameLine: string, date: string, pageBreak: (n: number) => string }} */
const DEFAULT_LABELS = { nameLine: 'Ime:', date: 'Datum:', pageBreak: (n) => `Stran ${n}` };

/**
 * @param {import('../text/runs.js').StyledRun[]} runs
 * @param {HTMLElement} container
 */
export function renderRuns(runs, container) {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const span = document.createElement('span');
    span.textContent = run.text;
    span.style.color = run.color;
    fragment.append(span);
  }
  container.replaceChildren(fragment);
}

/**
 * @param {import('../layout/rulings.js').RulingDefinition} ruling
 * @param {number} rowCount
 * @param {number} contentWidthMm
 * @returns {SVGSVGElement}
 */
export function renderRulingSvg(ruling, rowCount, contentWidthMm) {
  const rows = buildRulingRows(ruling, rowCount);
  const totalHeightMm = rowCount * ruling.lineHeightMm;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${contentWidthMm} ${totalHeightMm}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${totalHeightMm}mm`);
  svg.classList.add('ws-ruling');

  for (const row of rows) {
    for (const guide of row.guides) {
      const y = row.topMm + guide.offsetMm;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(contentWidthMm));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      line.classList.add('ws-ruling-line', `ws-ruling-${guide.type}`, `ws-ruling-${guide.style}`);
      svg.append(line);
    }
  }
  return svg;
}

/**
 * @param {{ nameLine: boolean, date: boolean }} header
 * @param {typeof DEFAULT_LABELS} labels
 * @returns {HTMLElement | null}
 */
function renderHeaderFields(header, labels) {
  if (!header.nameLine && !header.date) return null;
  const wrap = document.createElement('div');
  wrap.className = 'ws-header';
  if (header.nameLine) {
    const field = document.createElement('div');
    field.className = 'ws-header-field ws-header-name';
    field.textContent = labels.nameLine;
    wrap.append(field);
  }
  if (header.date) {
    const field = document.createElement('div');
    field.className = 'ws-header-field ws-header-date';
    field.textContent = labels.date;
    wrap.append(field);
  }
  return wrap;
}

/**
 * Measures the body's actual rendered visual lines (blueprint 8.6:
 * "alternating paragraphs is not equivalent to alternating physical lines
 * — extract line boundaries after browser layout"). A Range over a whole
 * paragraph's contents yields one client rect per style-run fragment, so
 * same-line fragments (several differently-colored spans on one wrapped
 * line) are merged by rounding their top edge — real line boxes never
 * share a top within a fraction of a pixel, styled fragments on the same
 * line always do. Requires `bodyElement` to already be attached to the
 * document; unattached nodes report zero-size rects.
 * @param {HTMLElement} bodyElement
 * @returns {Array<{ topMm: number, heightMm: number }>}
 */
export function measureBodyLineBoxes(bodyElement) {
  const containerRect = bodyElement.getBoundingClientRect();
  const lineMap = new Map();
  for (const paragraph of bodyElement.children) {
    if (!(paragraph instanceof HTMLElement) || paragraph.classList.contains('ws-line-stripes')) continue;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0 || rect.height === 0) continue;
      const key = Math.round(rect.top);
      const existing = lineMap.get(key);
      if (existing) {
        existing.top = Math.min(existing.top, rect.top);
        existing.bottom = Math.max(existing.bottom, rect.bottom);
      } else {
        lineMap.set(key, { top: rect.top, bottom: rect.bottom });
      }
    }
  }
  return [...lineMap.values()]
    .sort((a, b) => a.top - b.top)
    .map((line) => ({
      topMm: pxToMm(line.top - containerRect.top),
      heightMm: pxToMm(line.bottom - line.top)
    }));
}

/**
 * Inserts a faint alternating background behind every other measured line
 * (brief section 5: "zebra striping to keep the reader's eye anchored").
 * Absolutely positioned behind the text (blueprint: never hides/clips
 * content — this only paints behind it), driven entirely by real measured
 * line boxes, never a fixed-height CSS repeat (which would drift from the
 * text the moment font metrics or wrapping changed).
 * @param {HTMLElement} bodyElement already attached to the document
 */
export function applyLineStripes(bodyElement) {
  const lines = measureBodyLineBoxes(bodyElement);
  const overlay = document.createElement('div');
  overlay.className = 'ws-line-stripes';
  lines.forEach((line, index) => {
    if (index % 2 !== 1) return; // stripe every other line
    const stripe = document.createElement('div');
    stripe.className = 'ws-line-stripe';
    stripe.style.top = `${line.topMm}mm`;
    stripe.style.height = `${line.heightMm}mm`;
    overlay.append(stripe);
  });
  bodyElement.prepend(overlay);
}

/**
 * Absolutely-positioned dashed markers showing where the model expects a
 * page break — screen-only preview aid (upgrade blueprint v3, workstream
 * A), never rendered into the print surface or a packet sheet. `.ws-page`
 * has no fixed height (it grows with content, potentially spanning what
 * will print as several pages), so a marker is positioned at its mm
 * offset from the page's own top rather than inserted into element flow.
 * @param {HTMLElement} page already has `position: relative`
 * @param {number[]} pageBreaksMm
 * @param {(n: number) => string} pageBreakLabel translates "Page {n}" for the active locale — was hardcoded English until found in a 2026-09-20 review, since this app is otherwise fully localized
 */
function renderPageBreakMarkers(page, pageBreaksMm, pageBreakLabel) {
  pageBreaksMm.forEach((offsetMm, index) => {
    const marker = document.createElement('div');
    marker.className = 'ws-page-break-marker no-print';
    marker.style.top = `${offsetMm}mm`;
    const label = document.createElement('span');
    label.className = 'ws-page-break-label';
    label.textContent = pageBreakLabel(index + 2);
    marker.append(label);
    page.append(marker);
  });
}

/**
 * Renders the complete worksheet page into `container`, replacing its
 * children. `layout.copyBlocks` (rows per block; empty outside read-copy
 * mode) and `layout.pageBreaksMm` are layout decisions made upstream by
 * layout/measure.js.
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {{ copyBlocks: number[], ruling: import('../layout/rulings.js').RulingDefinition, contentWidthMm: number, pageBreaksMm?: number[] }} layout
 * @param {HTMLElement} container
 * @param {typeof DEFAULT_LABELS} [labels]
 * @param {boolean} [previewMode] when true, draws page-break markers (screen preview only — never the print surface or a packet sheet)
 */
export function renderWorksheet(model, layout, container, labels = DEFAULT_LABELS, previewMode = false) {
  const page = document.createElement('div');
  page.className = 'ws-page';
  const fontFamily = FONT_FAMILIES[model.settings.fontId] ?? model.settings.fontId;
  page.style.setProperty('--ws-font-family', `"${fontFamily}"`);
  page.style.setProperty('--ws-font-size-pt', String(model.settings.fontSizePt));
  page.style.setProperty('--ws-line-height', String(model.settings.lineHeightMultiplier));
  page.style.setProperty('--ws-letter-spacing-mm', `${ptToMm(model.settings.letterSpacingPt)}mm`);
  page.style.setProperty('--ws-word-spacing-mm', `${ptToMm(model.settings.extraWordSpacePt)}mm`);
  // Same box the DOCX exporter contains the image within (src/layout/imageBox.js) — one source for the slot size (workstream D1).
  page.style.setProperty('--ws-image-max-width-mm', `${IMAGE_BOX_MAX_WIDTH_MM}mm`);
  page.style.setProperty('--ws-image-max-height-mm', `${IMAGE_BOX_MAX_HEIGHT_MM}mm`);

  const tintId = model.settings.tintId ?? 'none';
  if (tintId !== 'none') {
    page.classList.add('ws-page--tinted');
    page.style.setProperty('--ws-tint-color', TINTS_BY_ID[tintId]);
    page.classList.toggle('ws-page--print-tint', Boolean(model.settings.printTint));
  }

  const headerEl = renderHeaderFields(model.header, labels);
  if (headerEl) page.append(headerEl);

  if (model.header.title) {
    const title = document.createElement('h1');
    title.className = 'ws-title';
    title.textContent = model.header.titleText;
    page.append(title);
  }

  const imageWrap = document.createElement('div');
  imageWrap.className = 'ws-image-wrap';
  const img = document.createElement('img');
  img.className = 'ws-image';
  img.src = model.image.path;
  img.alt = '';
  imageWrap.append(img);
  page.append(imageWrap);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'ws-body';
  bodyWrap.classList.toggle('ws-sentence-per-line', model.bodyParagraphs.length > 1);
  for (const paragraphRuns of model.bodyParagraphs) {
    const paragraph = document.createElement('p');
    paragraph.className = 'ws-sentence';
    renderRuns(paragraphRuns, paragraph);
    bodyWrap.append(paragraph);
  }
  page.append(bodyWrap);

  if (model.settings.writingMode === 'read-copy' && layout.copyBlocks?.length > 0) {
    const copyArea = document.createElement('div');
    copyArea.className = 'ws-copy-area';
    layout.copyBlocks.forEach((rows, index) => {
      const block = document.createElement('div');
      block.className = 'ws-copy-block';
      if (index === 0) {
        block.style.marginTop = `${COPY_AREA_GAP_MM}mm`;
      } else {
        // A second copy block means the fit check decided the copy
        // exercise needs a fresh page (blueprint v3, workstream A) —
        // break-before: page only takes effect when actually printed.
        block.classList.add('ws-copy-block--new-page');
      }
      block.append(renderRulingSvg(layout.ruling, rows, layout.contentWidthMm));
      copyArea.append(block);
    });
    page.append(copyArea);
  }

  container.replaceChildren(page);

  // Must run after the page is attached (above) — measuring line boxes on
  // detached nodes returns all-zero rects, since there's no layout yet.
  if (model.settings.lineStripes) {
    page.classList.add('ws-page--striped');
    page.classList.toggle('ws-page--print-stripes', Boolean(model.settings.printStripes));
    applyLineStripes(bodyWrap);
  }

  if (previewMode && layout.pageBreaksMm?.length > 0) {
    renderPageBreakMarkers(page, layout.pageBreaksMm, labels.pageBreak ?? DEFAULT_LABELS.pageBreak);
  }

  return page;
}
