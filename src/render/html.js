/**
 * Builds safe DOM nodes for screen preview and print from the shared
 * worksheet model. Never re-implements letter/syllable coloring — it only
 * renders the StyledRun[] it is given. Text always enters through
 * textContent, never innerHTML (blueprint 8.6).
 */

import { buildRulingRows } from '../layout/rulings.js';
import { ptToMm, FONT_FAMILIES, COPY_AREA_GAP_MM } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {{ nameLine: string, date: string }} */
const DEFAULT_LABELS = { nameLine: 'Ime:', date: 'Datum:' };

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
 * Renders the complete worksheet page into `container`, replacing its
 * children. `rowCount` is a layout decision made upstream by
 * layout/measure.js (0 / ignored outside read-copy mode).
 * @param {import('../worksheet/build.js').WorksheetModel} model
 * @param {{ rowCount: number, ruling: import('../layout/rulings.js').RulingDefinition, contentWidthMm: number }} layout
 * @param {HTMLElement} container
 * @param {typeof DEFAULT_LABELS} [labels]
 */
export function renderWorksheet(model, layout, container, labels = DEFAULT_LABELS) {
  const page = document.createElement('div');
  page.className = 'ws-page';
  const fontFamily = FONT_FAMILIES[model.settings.fontId] ?? model.settings.fontId;
  page.style.setProperty('--ws-font-family', `"${fontFamily}"`);
  page.style.setProperty('--ws-font-size-pt', String(model.settings.fontSizePt));
  page.style.setProperty('--ws-line-height', String(model.settings.lineHeightMultiplier));
  page.style.setProperty('--ws-letter-spacing-mm', `${ptToMm(model.settings.letterSpacingPt)}mm`);
  page.style.setProperty('--ws-word-spacing-mm', `${ptToMm(model.settings.extraWordSpacePt)}mm`);

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

  const body = document.createElement('p');
  body.className = 'ws-body';
  renderRuns(model.bodyRuns, body);
  page.append(body);

  if (model.settings.writingMode === 'read-copy' && layout.rowCount > 0) {
    const copyArea = document.createElement('div');
    copyArea.className = 'ws-copy-area';
    copyArea.style.marginTop = `${COPY_AREA_GAP_MM}mm`;
    copyArea.append(renderRulingSvg(layout.ruling, layout.rowCount, layout.contentWidthMm));
    page.append(copyArea);
  }

  container.replaceChildren(page);
  return page;
}
