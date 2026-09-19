/**
 * Application startup and dependency wiring. Deliberately thin: event
 * handlers update state and request a render; they never build DOCX or
 * parse syllables themselves (blueprint section 5).
 */

import slPack from '../content/sl.json';
import blueKiteUrl from '../assets/images/blue_kite.jpg';
import kiteYellowFieldUrl from '../assets/images/kite_yellow_field.jpg';

import { validatePack } from './content/validate.js';
import { buildWorksheet } from './worksheet/build.js';
import { renderWorksheet } from './render/html.js';
import { measureWorksheet } from './layout/measure.js';
import { isPrintReady, printWorksheet } from './export/print.js';
import { exportDocx } from './export/docx.js';

const KNOWN_ASSET_IDS = new Set(['blue_kite', 'kite_yellow_field']);
const IMAGES_BY_ID = new Map([
  ['blue_kite', { id: 'blue_kite', path: blueKiteUrl }],
  ['kite_yellow_field', { id: 'kite_yellow_field', path: kiteYellowFieldUrl }]
]);

const validation = validatePack(slPack, KNOWN_ASSET_IDS);
if (!validation.ok) {
  // eslint-disable-next-line no-console
  console.error('Starter content pack failed validation:', validation.errors);
  throw new Error('Starter content pack failed validation — see console for details.');
}
const CATALOG = new Map(validation.pack.entries.map((entry) => [entry.id, { ...entry, language: validation.pack.language }]));

/** Single mutable state object (blueprint section 5). */
const state = {
  contentId: 'stories_lost_kite_1',
  revision: 0,
  settings: {
    fontId: 'andika',
    fontSizePt: 16,
    lineHeightMultiplier: 1.4,
    letterSpacingPt: 0.3,
    extraWordSpacePt: 1,
    writingMode: 'read-copy',
    rulingId: 'standard-3line',
    guideHeightMm: 10,
    letterColors: { b: '#B42318', d: '#166534', p: '#7C3AED', q: '#B45309' },
    syllableMode: 'colors',
    syllableColors: ['#1D4ED8', '#B45309'],
    header: { nameLine: true, date: true, title: true },
    personalization: { name: '' },
    marginMm: 20
  },
  lastGood: null // { model, layout, imageBytesPromise }
};

const els = {
  preview: document.getElementById('preview'),
  printSurface: document.getElementById('print-surface'),
  fitIndicator: document.getElementById('fit-indicator'),
  printButton: document.getElementById('btn-print'),
  docxButton: document.getElementById('btn-docx'),
  contentSelect: document.getElementById('content-select'),
  writingModeSelect: document.getElementById('writing-mode-select')
};

function selectContent(id) {
  state.contentId = id;
  requestRender();
}

function updateWritingMode(mode) {
  state.settings.writingMode = mode;
  requestRender();
}

function showFit(model, result) {
  const el = els.fitIndicator;
  el.classList.toggle('is-overflow', !result.ok);
  if (result.ok) {
    el.textContent = `Fits — ${model.wordCount} words, level ${model.level}. Used ${(result.heightsMm.final ?? result.heightsMm.used).toFixed(1)}mm of ${result.heightsMm.budget.toFixed(1)}mm.`;
  } else {
    el.textContent = `Does not fit on one page (${result.code}): needs ${result.details.requiredHeightMm.toFixed(1)}mm, budget is ${result.details.availableHeightMm.toFixed(1)}mm. Try: ${result.suggestions?.join(', ') ?? 'reduce content'}.`;
  }
}

async function requestRender() {
  const revision = ++state.revision;
  const entry = CATALOG.get(state.contentId);
  const model = buildWorksheet(entry, state.settings, { imagesById: IMAGES_BY_ID }, entry.language);

  const result = await measureWorksheet(model, revision);
  if (revision !== state.revision) return; // stale async result, discard

  showFit(model, result);
  els.printButton.disabled = !isPrintReady(result);
  els.docxButton.disabled = !isPrintReady(result);

  if (!result.ok) {
    state.lastGood = null;
    els.preview.replaceChildren();
    els.printSurface.replaceChildren();
    return;
  }

  renderWorksheet(model, result.layout, els.preview);
  renderWorksheet(model, result.layout, els.printSurface);
  state.lastGood = { model, layout: result.layout };
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function handleExportDocx() {
  if (!state.lastGood) return;
  try {
    const { model, layout } = state.lastGood;
    const imageBytes = dataUrlToUint8Array(model.image.path);
    const blob = await exportDocx(model, layout, imageBytes);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worksheet-${model.contentKey.language}-level-${model.level}.docx`;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the in-flight download in some
    // browsers (verified: Chromium reports the download as "canceled" with
    // 0 bytes received if revoked synchronously) — give it a moment first.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('DOCX export failed:', error);
    els.fitIndicator.textContent = `Export failed: ${error.message}. See browser console for details.`;
    els.fitIndicator.classList.add('is-overflow');
  }
}

els.contentSelect.addEventListener('change', (event) => selectContent(event.target.value));
els.writingModeSelect.addEventListener('change', (event) => updateWritingMode(event.target.value));
els.printButton.addEventListener('click', printWorksheet);
els.docxButton.addEventListener('click', handleExportDocx);

requestRender();
