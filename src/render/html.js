/**
 * Builds safe DOM nodes for screen preview and print from the shared
 * worksheet model. Never re-implements letter/syllable coloring — it only
 * renders the StyledRun[] it is given. Text always enters through
 * textContent, never innerHTML (blueprint 8.6).
 */

import { buildRulingRows, getRuling } from '../layout/rulings.js';
import { contentWidthMm, ptToMm, pxToMm, FONT_FAMILIES, COPY_AREA_GAP_MM, TINTS_BY_ID, LINE_NUMBER_GUTTER_MM, DRAWING_BOX_GAP_MM, COPY_MARK_COLOR, SEQUENCE_BOX_FACTOR } from '../config.js';
import { IMAGE_BOX_MAX_WIDTH_MM, IMAGE_BOX_MAX_HEIGHT_MM, IMAGE_BOX_LARGE } from '../layout/imageBox.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {{ nameLine: string, date: string, pageBreak: (n: number) => string }} */
const DEFAULT_LABELS = {
  nameLine: 'Ime:',
  date: 'Datum:',
  pageBreak: (n) => `Stran ${n}`,
  // No fallback text for what a child reads: a caller that renders an
  // instruction without the locale's labels is a bug (i18n.sheetLabels).
  instruction: (key) => {
    throw new Error(`MISSING_LABEL: sheet.instruction.${key}`);
  },
  answers: 'Rešitve'
};

/**
 * One span per run. Word and syllable ids (src/text/tokenize.js) go on as
 * `data-w` / `data-syl`, numbers only, so later features can find a word or
 * syllable in the rendered page (click targets, arcs) without re-deriving
 * anything from the text.
 * A gap (run.blank) is an inline-block of the sheet's one gap width with
 * the answer inside it; CSS paints the answer faintly on screen and hides
 * it in print, so the box — and the layout — is the same in both.
 * @param {import('../text/runs.js').StyledRun[]} runs
 * @param {HTMLElement} container
 * @param {number} [blankWidthEm] the width of every gap (passage block)
 */
export function renderRuns(runs, container, blankWidthEm = 0) {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    if (run.blank) {
      const gap = document.createElement('span');
      gap.className = 'ws-blank';
      gap.style.width = `${blankWidthEm}em`;
      gap.dataset.w = String(run.w);
      const answer = document.createElement('span');
      answer.className = 'ws-blank-answer';
      answer.textContent = run.text;
      gap.append(answer);
      fragment.append(gap);
      continue;
    }
    const span = document.createElement('span');
    span.textContent = run.text;
    span.style.color = run.color;
    if (run.bold) span.style.fontWeight = '700';
    if (run.w !== undefined) span.dataset.w = String(run.w);
    if (run.syl !== undefined) span.dataset.syl = String(run.syl);
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
 * document; unattached nodes report zero-size rects. Only the text
 * paragraphs (.ws-sentence) are measured, never the overlays drawn from
 * this measurement (stripes, line numbers).
 * @param {HTMLElement} bodyElement
 * @returns {Array<{ topMm: number, heightMm: number }>}
 */
export function measureBodyLineBoxes(bodyElement) {
  const containerRect = bodyElement.getBoundingClientRect();
  const lineMap = new Map();
  for (const paragraph of bodyElement.children) {
    if (!(paragraph instanceof HTMLElement) || !paragraph.classList.contains('ws-sentence')) continue;
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
 * Numbers every measured passage line in the gutter the passage block
 * reserves with its left padding (settings.lineNumbers, handbook §11.6
 * B9). One continuous count across printed pages, like Word's line
 * numbering in the DOCX export. Same measurement as the stripes.
 * @param {HTMLElement} bodyElement already attached to the document
 */
export function applyLineNumbers(bodyElement) {
  const overlay = document.createElement('div');
  overlay.className = 'ws-line-numbers';
  measureBodyLineBoxes(bodyElement).forEach((line, index) => {
    const number = document.createElement('div');
    number.className = 'ws-line-number';
    number.style.top = `${line.topMm}mm`;
    number.style.height = `${line.heightMm}mm`;
    number.textContent = String(index + 1);
    overlay.append(number);
  });
  bodyElement.append(overlay);
}

/**
 * Syllable arcs (handbook §11.6 B7): one curve under each syllable —
 * one-syllable words included — drawn in the descender zone from the
 * union of that syllable's spans (grouped by data-w + data-syl; no
 * hyphenation, so a syllable is never split across lines). One small SVG
 * per measured line, in millimetres and positioned like the stripes. Not
 * one SVG for the whole passage: an SVG is a single unbreakable box, and
 * Firefox's print added pages rather than split a tall one (7 printed
 * where 5 were measured; 5 with the overlay removed).
 * @param {HTMLElement} bodyElement already attached to the document
 * @param {string} color
 */
export function applySyllableArcs(bodyElement, color) {
  const bodyRect = bodyElement.getBoundingClientRect();
  /** @type {Map<string, { left: number, right: number, top: number, bottom: number }>} */
  const syllables = new Map();
  for (const span of bodyElement.querySelectorAll('.ws-sentence [data-w][data-syl]')) {
    for (const rect of span.getClientRects()) {
      if (rect.width === 0) continue;
      const key = `${span.dataset.w}:${span.dataset.syl}:${Math.round(rect.top)}`;
      const box = syllables.get(key);
      if (box) {
        box.left = Math.min(box.left, rect.left);
        box.right = Math.max(box.right, rect.right);
        box.bottom = Math.max(box.bottom, rect.bottom);
      } else {
        syllables.set(key, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
    }
  }
  const widthMm = pxToMm(bodyRect.width);
  const lines = measureBodyLineBoxes(bodyElement).map((line) => ({ ...line, paths: [] }));
  for (const box of syllables.values()) {
    const middleMm = pxToMm((box.top + box.bottom) / 2 - bodyRect.top);
    const line = lines.find((l) => middleMm >= l.topMm && middleMm <= l.topMm + l.heightMm);
    if (!line) continue;
    const x1 = pxToMm(box.left - bodyRect.left);
    const x2 = pxToMm(box.right - bodyRect.left);
    const h = pxToMm(box.bottom - box.top);
    const inset = Math.min(0.4, (x2 - x1) * 0.15);
    const y = pxToMm(box.bottom - bodyRect.top) - line.topMm - h * 0.12;
    line.paths.push(`M ${x1 + inset} ${y} Q ${(x1 + x2) / 2} ${y + h * 0.2} ${x2 - inset} ${y}`);
  }
  for (const line of lines) {
    if (line.paths.length === 0) continue;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ws-arcs');
    svg.setAttribute('viewBox', `0 0 ${widthMm} ${line.heightMm}`);
    svg.style.top = `${line.topMm}mm`;
    svg.style.width = `${widthMm}mm`;
    svg.style.height = `${line.heightMm}mm`;
    svg.style.setProperty('--ws-arc-color', color);
    for (const d of line.paths) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'ws-arc');
      svg.append(path);
    }
    bodyElement.append(svg);
  }
}

/**
 * Marks what the child copies (handbook §11.6 A3): a thin bar beside every
 * measured line that holds a word of the target. An overlay, positioned
 * from the same line boxes as the stripes, so the layout doesn't change.
 * @param {HTMLElement} bodyElement already attached to the document
 * @param {{ firstW: number, lastW: number }} range
 */
export function applyCopyMark(bodyElement, { firstW, lastW }) {
  const bodyTop = bodyElement.getBoundingClientRect().top;
  const targetTops = [...bodyElement.querySelectorAll('.ws-sentence [data-w]')]
    .filter((span) => Number(span.dataset.w) >= firstW && Number(span.dataset.w) <= lastW)
    .flatMap((span) => [...span.getClientRects()].map((rect) => pxToMm((rect.top + rect.bottom) / 2 - bodyTop)));
  const overlay = document.createElement('div');
  overlay.className = 'ws-copy-marks';
  for (const line of measureBodyLineBoxes(bodyElement)) {
    if (!targetTops.some((middle) => middle >= line.topMm && middle <= line.topMm + line.heightMm)) continue;
    const bar = document.createElement('div');
    bar.className = 'ws-copy-mark-bar';
    bar.style.top = `${line.topMm}mm`;
    bar.style.height = `${line.heightMm}mm`;
    overlay.append(bar);
  }
  bodyElement.append(overlay);
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
 * @typedef {object} BlockRenderContext
 * @property {import('../worksheet/build.js').WorksheetModel} model
 * @property {typeof DEFAULT_LABELS} labels
 */

/**
 * One renderer per block type (upgrade blueprint §11.5.3). Each returns
 * the block's element; renderWorksheet appends it and tags it with
 * `data-block`. Elements holding shaped text carry the `ws-text` class,
 * which the fit check's width-overflow test looks for. Must stay in step
 * with export/docx.js BLOCK_WRITERS (a unit test compares the key sets).
 * @type {Record<string, (block: any, context: BlockRenderContext) => HTMLElement>}
 */
export const BLOCK_RENDERERS = {
  answerTag: (block, { labels }) => {
    const tag = document.createElement('div');
    tag.className = 'ws-answer-tag ws-text';
    tag.textContent = labels.answers ?? DEFAULT_LABELS.answers;
    return tag;
  },
  header: (block, { labels }) => renderHeaderFields(block, labels),
  title: (block) => {
    const title = document.createElement('h1');
    title.className = 'ws-title ws-text';
    title.classList.toggle('ws-copy-mark', Boolean(block.copyMark));
    title.textContent = block.text;
    return title;
  },
  instruction: (block, { labels }) => {
    const line = document.createElement('p');
    line.className = 'ws-instruction ws-text';
    line.textContent = (labels.instruction ?? DEFAULT_LABELS.instruction)(block.key);
    return line;
  },
  image: (block, { model }) => {
    const imageWrap = document.createElement('div');
    imageWrap.className = 'ws-image-wrap';
    if (block.size === 'large') {
      // Overrides the page's normal box (set in renderWorksheet) for this image only.
      imageWrap.style.setProperty('--ws-image-max-width-mm', `${IMAGE_BOX_LARGE.widthMm}mm`);
      imageWrap.style.setProperty('--ws-image-max-height-mm', `${IMAGE_BOX_LARGE.heightMm}mm`);
    }
    const img = document.createElement('img');
    img.className = 'ws-image';
    img.src = model.image.path;
    img.alt = '';
    imageWrap.append(img);
    return imageWrap;
  },
  passage: (block) => {
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'ws-body';
    // More than one paragraph (sentence-per-line, or a text with authored
    // paragraph breaks) gets the same small gap between paragraphs; the DOCX
    // exporter applies the matching spacing-after.
    bodyWrap.classList.toggle('ws-sentence-per-line', block.paragraphs.length > 1);
    // The answer key: gaps show their word (bold, and printed).
    bodyWrap.classList.toggle('ws-body--answers', Boolean(block.showAnswers));
    if (block.lineNumbers) {
      bodyWrap.classList.add('ws-body--line-numbers');
      bodyWrap.style.setProperty('--ws-line-number-gutter-mm', `${LINE_NUMBER_GUTTER_MM}mm`);
    }
    for (const paragraphRuns of block.paragraphs) {
      const paragraph = document.createElement('p');
      paragraph.className = 'ws-sentence ws-text';
      renderRuns(paragraphRuns, paragraph, block.blankWidthEm);
      bodyWrap.append(paragraph);
    }
    return bodyWrap;
  },
  // "Put in order": one item per sentence, a square box for the child's
  // number, then the sentence. Items don't break across pages (the fit
  // check measures them one by one, layout/measure.js). In the answer key
  // the box shows the sentence's place in the text.
  sequence: (block, { model }) => {
    const list = document.createElement('div');
    list.className = 'ws-sequence';
    list.style.setProperty('--ws-sequence-box-mm', `${ptToMm(model.settings.fontSizePt * SEQUENCE_BOX_FACTOR)}mm`);
    for (const item of block.items) {
      const row = document.createElement('div');
      row.className = 'ws-sequence-item';
      const box = document.createElement('div');
      box.className = 'ws-sequence-box';
      if (block.showAnswers) box.textContent = String(item.position);
      const text = document.createElement('p');
      text.className = 'ws-sequence-text ws-text';
      renderRuns(item.runs, text);
      row.append(box, text);
      list.append(row);
    }
    return list;
  },
  // The teacher's own questions: each numbered, then ruled answer lines
  // drawn like the copy lines. A question and its lines are one unit for
  // the fit check (layout/measure.js), never split across pages.
  questions: (block, { model }) => {
    const s = model.settings;
    const ruling = getRuling(s.rulingId, s.guideHeightMm);
    const list = document.createElement('div');
    list.className = 'ws-questions';
    block.items.forEach((question, i) => {
      const item = document.createElement('div');
      item.className = 'ws-question';
      const text = document.createElement('p');
      text.className = 'ws-question-text ws-text';
      text.textContent = `${i + 1}. ${question}`;
      item.append(text, renderRulingSvg(ruling, block.linesEach, contentWidthMm(s.marginMm)));
      list.append(item);
    });
    return list;
  },
  drawingBox: (block) => {
    const box = document.createElement('div');
    box.className = 'ws-drawing-box';
    // Inline, from config, like the copy-area gap: the fit check measures
    // exactly what the DOCX writer also uses.
    box.style.height = `${block.heightMm}mm`;
    box.style.marginTop = `${DRAWING_BOX_GAP_MM}mm`;
    return box;
  }
};

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
  // Only on a sheet with a copy mark, so every other page's markup is unchanged.
  if (model.blocks.some((block) => block.copyMark)) page.style.setProperty('--ws-copy-mark-color', COPY_MARK_COLOR);

  const tintId = model.settings.tintId ?? 'none';
  if (tintId !== 'none') {
    page.classList.add('ws-page--tinted');
    page.style.setProperty('--ws-tint-color', TINTS_BY_ID[tintId]);
    page.classList.toggle('ws-page--print-tint', Boolean(model.settings.printTint));
  }

  for (const block of model.blocks) {
    const render = BLOCK_RENDERERS[block.type];
    if (!render) throw new Error(`UNKNOWN_BLOCK: "${block.type}"`);
    const el = render(block, { model, labels });
    // layout/measure.js finds blocks by this attribute, never by class names.
    el.dataset.block = block.type;
    page.append(el);
  }

  if (model.task === 'lines' && layout.copyBlocks?.length > 0) {
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
  const passageEl = page.querySelector(':scope > [data-block="passage"]');
  if (model.settings.lineStripes && passageEl) {
    page.classList.add('ws-page--striped');
    page.classList.toggle('ws-page--print-stripes', Boolean(model.settings.printStripes));
    applyLineStripes(passageEl);
  }
  const passageBlock = model.blocks.find((block) => block.type === 'passage');
  if (passageEl && passageBlock?.lineNumbers) {
    applyLineNumbers(passageEl);
  }
  if (passageEl && passageBlock?.copyMark) {
    applyCopyMark(passageEl, passageBlock.copyMark);
  }
  if (passageEl && passageBlock?.arcColor) {
    applySyllableArcs(passageEl, passageBlock.arcColor);
  }

  if (previewMode && layout.pageBreaksMm?.length > 0) {
    renderPageBreakMarkers(page, layout.pageBreaksMm, labels.pageBreak ?? DEFAULT_LABELS.pageBreak);
  }

  return page;
}
