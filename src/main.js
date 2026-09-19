/**
 * Application startup and dependency wiring. Deliberately thin: event
 * handlers update state and request a render; they never build DOCX or
 * parse syllables themselves (blueprint section 5).
 */

import slPack from '../content/sl.json';
import slLocale from '../locales/sl.json';
import imageData from './generated/imageData.json';

import { validatePack } from './content/validate.js';
import { buildCatalogIndex, findCandidates, chooseEntry, listThemes } from './content/catalog.js';
import { validateSettings } from './worksheet/validateSettings.js';
import { SETTINGS_LIMITS } from './config.js';
import { buildWorksheet } from './worksheet/build.js';
import { renderWorksheet } from './render/html.js';
import { measureWorksheet } from './layout/measure.js';
import { isPrintReady, printWorksheet } from './export/print.js';
import { exportDocx } from './export/docx.js';
import { createTranslator } from './i18n.js';

const t = createTranslator(slLocale);

const IMAGES_BY_ID = new Map(Object.entries(imageData).map(([id, path]) => [id, { id, path }]));
const KNOWN_ASSET_IDS = new Set(IMAGES_BY_ID.keys());

const validation = validatePack(slPack, KNOWN_ASSET_IDS);
if (!validation.ok) {
  // eslint-disable-next-line no-console
  console.error('Starter content pack failed validation:', validation.errors);
  throw new Error('Starter content pack failed validation — see console for details.');
}
const entriesWithLanguage = validation.pack.entries.map((entry) => ({ ...entry, language: validation.pack.language }));
const CATALOG = buildCatalogIndex(entriesWithLanguage);
const THEMES = listThemes(CATALOG);

/** Preserved so the letter-colors checkbox can restore real colors after being switched off. */
const DEFAULT_LETTER_COLORS = { b: '#B42318', d: '#166534', p: '#7C3AED', q: '#B45309' };

/** blueprint 8.6: "a Dyslexia-friendly preset as an adjustable starting point" — a starting combination, not a claim of clinical efficacy. */
const DYSLEXIA_PRESET = {
  fontSizePt: 18,
  lineHeightMultiplier: 1.6,
  letterSpacingPt: 0.5,
  extraWordSpacePt: 1.5,
  letterColorsEnabled: true,
  syllableColorsEnabled: true
};

/** Single mutable state object (blueprint section 5). */
const state = {
  filter: { theme: THEMES[0], level: 1 },
  contentId: null,
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
  lastGood: null // { model, layout }
};

const settingsCheck = validateSettings(state.settings);
if (!settingsCheck.ok) {
  // eslint-disable-next-line no-console
  console.error('Default settings failed validation:', settingsCheck.errors);
  throw new Error('Default settings failed validation — see console for details.');
}

const els = {
  preview: document.getElementById('preview'),
  printSurface: document.getElementById('print-surface'),
  fitIndicator: document.getElementById('fit-indicator'),
  printButton: document.getElementById('btn-print'),
  docxButton: document.getElementById('btn-docx'),
  createButton: document.getElementById('btn-create'),
  themeSelect: document.getElementById('theme-select'),
  levelSelect: document.getElementById('level-select'),
  writingModeSelect: document.getElementById('writing-mode-select'),
  candidateCount: document.getElementById('candidate-count'),
  fontSizeInput: document.getElementById('font-size-input'),
  lineHeightInput: document.getElementById('line-height-input'),
  letterSpacingInput: document.getElementById('letter-spacing-input'),
  wordSpacingInput: document.getElementById('word-spacing-input'),
  letterColorsToggle: document.getElementById('letter-colors-toggle'),
  syllableColorsToggle: document.getElementById('syllable-colors-toggle'),
  dyslexiaPresetButton: document.getElementById('btn-dyslexia-preset')
};

/** Applies t() to every element carrying a data-label key (blueprint 8.1: stable ids, looked-up labels). */
function applyStaticLabels() {
  document.title = t('app.title');
  for (const el of document.querySelectorAll('[data-label]')) {
    el.textContent = t(el.dataset.label);
  }
}

function populateThemeSelect() {
  els.themeSelect.replaceChildren(
    ...THEMES.map((theme) => {
      const option = document.createElement('option');
      option.value = theme;
      option.textContent = t(`theme.${theme}`);
      return option;
    })
  );
  els.themeSelect.value = state.filter.theme;
}

/** Updates the "N texts available" indicator without touching the displayed worksheet — a filter change alone must never silently swap the visible passage (blueprint 8.2). */
function updateCandidateCount() {
  const candidates = findCandidates(CATALOG, state.filter);
  els.candidateCount.textContent = candidates.length > 0
    ? t('candidates.available', { count: candidates.length })
    : t('candidates.none');
  els.createButton.disabled = candidates.length === 0;
  return candidates;
}

function updateFilter(partial) {
  Object.assign(state.filter, partial);
  updateCandidateCount();
}

function createText() {
  const candidates = findCandidates(CATALOG, state.filter);
  const entry = chooseEntry(candidates, state.contentId);
  if (!entry) return; // createButton is disabled in this case, but guard anyway
  state.contentId = entry.id;
  requestRender();
}

function updateWritingMode(mode) {
  state.settings.writingMode = mode;
  if (state.contentId) requestRender();
}

/** Sets each number input's min/max from the single shared limits config (blueprint 5) — never hardcoded in HTML. */
function applySettingsLimits() {
  els.fontSizeInput.min = SETTINGS_LIMITS.fontSizePt.min;
  els.fontSizeInput.max = SETTINGS_LIMITS.fontSizePt.max;
  els.lineHeightInput.min = SETTINGS_LIMITS.lineHeightMultiplier.min;
  els.lineHeightInput.max = SETTINGS_LIMITS.lineHeightMultiplier.max;
  els.letterSpacingInput.min = SETTINGS_LIMITS.letterSpacingPt.min;
  els.letterSpacingInput.max = SETTINGS_LIMITS.letterSpacingPt.max;
  els.wordSpacingInput.min = SETTINGS_LIMITS.extraWordSpacePt.min;
  els.wordSpacingInput.max = SETTINGS_LIMITS.extraWordSpacePt.max;
}

/** Reflects state.settings into the settings-panel controls — used at startup and after applying a preset. */
function syncSettingsControlsFromState() {
  const s = state.settings;
  els.fontSizeInput.value = s.fontSizePt;
  els.lineHeightInput.value = s.lineHeightMultiplier;
  els.letterSpacingInput.value = s.letterSpacingPt;
  els.wordSpacingInput.value = s.extraWordSpacePt;
  els.letterColorsToggle.checked = Object.keys(s.letterColors).length > 0;
  els.syllableColorsToggle.checked = s.syllableMode === 'colors';
}

function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

function updateNumericSetting(field, range, inputEl) {
  const value = clamp(Number(inputEl.value), range);
  state.settings[field] = value;
  inputEl.value = value; // reflect clamping back — the box must never show a value that isn't actually applied
  if (state.contentId) requestRender();
}

function updateLetterColorsEnabled(enabled) {
  state.settings.letterColors = enabled ? DEFAULT_LETTER_COLORS : {};
  if (state.contentId) requestRender();
}

function updateSyllableColorsEnabled(enabled) {
  state.settings.syllableMode = enabled ? 'colors' : 'off';
  if (state.contentId) requestRender();
}

function applyDyslexiaPreset() {
  Object.assign(state.settings, {
    fontSizePt: DYSLEXIA_PRESET.fontSizePt,
    lineHeightMultiplier: DYSLEXIA_PRESET.lineHeightMultiplier,
    letterSpacingPt: DYSLEXIA_PRESET.letterSpacingPt,
    extraWordSpacePt: DYSLEXIA_PRESET.extraWordSpacePt,
    letterColors: DYSLEXIA_PRESET.letterColorsEnabled ? DEFAULT_LETTER_COLORS : {},
    syllableMode: DYSLEXIA_PRESET.syllableColorsEnabled ? 'colors' : 'off'
  });
  syncSettingsControlsFromState();
  if (state.contentId) requestRender();
}

function showFit(model, result) {
  const el = els.fitIndicator;
  el.classList.toggle('is-overflow', !result.ok);
  if (result.ok) {
    el.textContent = t('fit.fits', {
      words: model.wordCount,
      level: model.level,
      used: (result.heightsMm.final ?? result.heightsMm.used).toFixed(1),
      budget: result.heightsMm.budget.toFixed(1)
    });
  } else {
    const suggestions = (result.suggestions ?? []).map((code) => t(`fit.suggestion.${code}`)).join(', ');
    el.textContent = t('fit.overflow', {
      code: result.code,
      required: result.details.requiredHeightMm.toFixed(1),
      available: result.details.availableHeightMm.toFixed(1),
      suggestions
    });
  }
}

async function requestRender() {
  const revision = ++state.revision;
  const entry = CATALOG.byId.get(state.contentId);
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

  const labels = { nameLine: t('header.nameLine'), date: t('header.date') };
  renderWorksheet(model, result.layout, els.preview, labels);
  renderWorksheet(model, result.layout, els.printSurface, labels);
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
    els.fitIndicator.textContent = t('export.failed', { message: error.message });
    els.fitIndicator.classList.add('is-overflow');
  }
}

els.themeSelect.addEventListener('change', (event) => updateFilter({ theme: event.target.value }));
els.levelSelect.addEventListener('change', (event) => updateFilter({ level: Number(event.target.value) }));
els.createButton.addEventListener('click', createText);
els.writingModeSelect.addEventListener('change', (event) => updateWritingMode(event.target.value));
els.printButton.addEventListener('click', printWorksheet);
els.docxButton.addEventListener('click', handleExportDocx);

els.fontSizeInput.addEventListener('change', (e) => updateNumericSetting('fontSizePt', SETTINGS_LIMITS.fontSizePt, e.target));
els.lineHeightInput.addEventListener('change', (e) => updateNumericSetting('lineHeightMultiplier', SETTINGS_LIMITS.lineHeightMultiplier, e.target));
els.letterSpacingInput.addEventListener('change', (e) => updateNumericSetting('letterSpacingPt', SETTINGS_LIMITS.letterSpacingPt, e.target));
els.wordSpacingInput.addEventListener('change', (e) => updateNumericSetting('extraWordSpacePt', SETTINGS_LIMITS.extraWordSpacePt, e.target));
els.letterColorsToggle.addEventListener('change', (e) => updateLetterColorsEnabled(e.target.checked));
els.syllableColorsToggle.addEventListener('change', (e) => updateSyllableColorsEnabled(e.target.checked));
els.dyslexiaPresetButton.addEventListener('click', applyDyslexiaPreset);

applyStaticLabels();
populateThemeSelect();
updateCandidateCount();
applySettingsLimits();
syncSettingsControlsFromState();
els.fitIndicator.textContent = t('fit.measuring');
createText(); // show something on first load rather than an empty preview
