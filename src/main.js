/**
 * Application startup and dependency wiring. Deliberately thin: event
 * handlers update state and request a render; they never build DOCX or
 * parse syllables themselves (blueprint section 5).
 */

import slPack from '../content/sl.json';
import enPack from '../content/en.json';
import dePack from '../content/de.json';
import frPack from '../content/fr.json';
import esPack from '../content/es.json';
import slLocale from '../locales/sl.json';
import enLocale from '../locales/en.json';
import deLocale from '../locales/de.json';
import frLocale from '../locales/fr.json';
import esLocale from '../locales/es.json';
import imageData from './generated/imageData.json';

import { validatePack } from './content/validate.js';
import { buildCatalogIndex, findCandidates, chooseEntry, listThemes } from './content/catalog.js';
import { validateSettings } from './worksheet/validateSettings.js';
import { buildWorksheet } from './worksheet/build.js';
import { renderWorksheet } from './render/html.js';
import { measureWorksheet } from './layout/measure.js';
import { isPrintReady, printWorksheet } from './export/print.js';
import { exportDocx } from './export/docx.js';
import { createTranslator, sheetLabels } from './i18n.js';
import { checkStorageCapability } from './storage.js';
import { readImageFile } from './import.js';
import { init as initPacketUi } from './ui/packet.js';
import { init as initPresetsUi } from './ui/presets.js';
import { init as initContentImportUi } from './ui/contentImport.js';
import { init as initSettingsPanelUi } from './ui/settingsPanel.js';

/** blueprint 8.1: "The interface starts in Slovene for the pilot." */
const DEFAULT_LANGUAGE = 'sl';
const CONTENT_PACKS = { sl: slPack, en: enPack, de: dePack, fr: frPack, es: esPack };
const LOCALES = { sl: slLocale, en: enLocale, de: deLocale, fr: frLocale, es: esLocale };
const LANGUAGES = Object.keys(CONTENT_PACKS);

// Reassigned by switchLanguage() — not const, since the active locale/catalog change at runtime.
let t = createTranslator(LOCALES[DEFAULT_LANGUAGE]);

const IMAGES_BY_ID = new Map(
  Object.entries(imageData).map(([id, { dataUrl, width, height }]) => [id, { id, path: dataUrl, width, height }])
);
const KNOWN_ASSET_IDS = new Set(IMAGES_BY_ID.keys());

/**
 * @param {string} language
 * @returns {import('./content/catalog.js').CatalogIndex}
 */
function validateAndBuildCatalog(language) {
  const validation = validatePack(CONTENT_PACKS[language], KNOWN_ASSET_IDS);
  if (!validation.ok) {
    // eslint-disable-next-line no-console
    console.error(`Content pack "${language}" failed validation:`, validation.errors);
    throw new Error(`Content pack "${language}" failed validation — see console for details.`);
  }
  const entriesWithLanguage = validation.pack.entries.map((entry) => ({ ...entry, language: validation.pack.language }));
  return buildCatalogIndex(entriesWithLanguage);
}

// Validate every bundled pack up front — a broken pack for a language the
// teacher hasn't picked yet should still fail loudly at startup, not later.
// Cached per language (not just validated-and-discarded) so content import
// (below) has somewhere to install a replacement catalog.
/** @type {Record<string, import('./content/catalog.js').CatalogIndex>} */
const CATALOGS = {};
for (const language of LANGUAGES) CATALOGS[language] = validateAndBuildCatalog(language);

let CATALOG = CATALOGS[DEFAULT_LANGUAGE];
let THEMES = listThemes(CATALOG);

/**
 * Installs a session-only replacement catalog for a language (teacher
 * content import); if it is the active language, the theme list follows.
 * Lives here because CATALOG/THEMES are this module's own bindings —
 * ui/contentImport.js cannot reassign them.
 * @param {string} language
 * @param {import('./content/catalog.js').CatalogIndex} catalog
 */
function installCatalog(language, catalog) {
  CATALOGS[language] = catalog;
  if (language === state.language) {
    CATALOG = CATALOGS[language];
    THEMES = listThemes(CATALOG);
    populateThemeSelect();
  }
}

/** Preserved so the letter-colors checkbox can restore real colors after being switched off. */
const DEFAULT_LETTER_COLORS = { b: '#B42318', d: '#166534', p: '#7C3AED', q: '#B45309' };

/** Single mutable state object (blueprint section 5). */
const state = {
  language: DEFAULT_LANGUAGE,
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
    header: { nameLine: true, date: true, title: true, instructions: true },
    sentencePerLine: false,
    tintId: 'none',
    printTint: false,
    lineStripes: false,
    printStripes: false,
    lineNumbers: false,
    imageSlot: 'picture',
    graphemes: [],
    wordSpaceMarks: false,
    marginMm: 20
  },
  // How the preview is viewed, never what is printed: not in settings,
  // presets, the model or the print surface (handbook §11.8).
  view: { grayscale: false },
  customImage: null, // { id: 'custom', path: dataUrl } | null — session-only, never persisted (blueprint 8.8/section 15)
  lastGood: null, // { model, layout }
  packet: [] // ordered PacketSnapshot[] (worksheet/packet.js) — frozen { id, title, language, level, model, layout, labels }, never live references (blueprint 8.10/6)
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
  fitNotices: document.getElementById('fit-notices'),
  printButton: document.getElementById('btn-print'),
  docxButton: document.getElementById('btn-docx'),
  createButton: document.getElementById('btn-create'),
  languageSelect: document.getElementById('language-select'),
  themeSelect: document.getElementById('theme-select'),
  levelSelect: document.getElementById('level-select'),
  writingModeSelect: document.getElementById('writing-mode-select'),
  imageSlotSelect: document.getElementById('image-slot-select'),
  candidateCount: document.getElementById('candidate-count'),
  textSelect: document.getElementById('text-select'),
  textSelectLabel: document.getElementById('text-select-label'),
  fontSelect: document.getElementById('font-select'),
  fontSizeInput: document.getElementById('font-size-input'),
  lineHeightInput: document.getElementById('line-height-input'),
  letterSpacingInput: document.getElementById('letter-spacing-input'),
  wordSpacingInput: document.getElementById('word-spacing-input'),
  letterColorsToggle: document.getElementById('letter-colors-toggle'),
  graphemesInput: document.getElementById('graphemes-input'),
  graphemesStatus: document.getElementById('graphemes-status'),
  syllableColorsToggle: document.getElementById('syllable-colors-toggle'),
  syllableSeparatorsToggle: document.getElementById('syllable-separators-toggle'),
  sentencePerLineToggle: document.getElementById('sentence-per-line-toggle'),
  wordSpaceMarksToggle: document.getElementById('word-space-marks-toggle'),
  tintSelect: document.getElementById('tint-select'),
  printTintToggle: document.getElementById('print-tint-toggle'),
  lineStripesToggle: document.getElementById('line-stripes-toggle'),
  printStripesToggle: document.getElementById('print-stripes-toggle'),
  lineNumbersToggle: document.getElementById('line-numbers-toggle'),
  grayscalePreviewToggle: document.getElementById('grayscale-preview-toggle'),
  headerNameLineToggle: document.getElementById('header-nameline-toggle'),
  headerDateToggle: document.getElementById('header-date-toggle'),
  headerTitleToggle: document.getElementById('header-title-toggle'),
  headerInstructionsToggle: document.getElementById('header-instructions-toggle'),
  guideHeightInput: document.getElementById('guide-height-input'),
  dyslexiaPresetButton: document.getElementById('btn-dyslexia-preset'),
  presetSelect: document.getElementById('preset-select'),
  loadPresetButton: document.getElementById('btn-load-preset'),
  deletePresetButton: document.getElementById('btn-delete-preset'),
  savePresetButton: document.getElementById('btn-save-preset'),
  storageStatus: document.getElementById('storage-status'),
  imageUpload: document.getElementById('image-upload'),
  resetImageButton: document.getElementById('btn-reset-image'),
  imageStatus: document.getElementById('image-status'),
  packetCount: document.getElementById('packet-count'),
  packetList: document.getElementById('packet-list'),
  addToPacketButton: document.getElementById('btn-add-to-packet'),
  printPacketButton: document.getElementById('btn-print-packet'),
  clearPacketButton: document.getElementById('btn-clear-packet'),
  packetStatus: document.getElementById('packet-status'),
  importJsonInput: document.getElementById('import-json-input'),
  importImagesInput: document.getElementById('import-images-input'),
  importContentButton: document.getElementById('btn-import-content'),
  importStatus: document.getElementById('import-status'),
  exportSetupsButton: document.getElementById('btn-export-setups'),
  importSetupsInput: document.getElementById('import-setups-input'),
  resetDataButton: document.getElementById('btn-reset-data')
};

// UI coordinators extracted from this file (0.8.1, workstream J1). Each
// gets the shared state/els and a translator *getter* (t is reassigned on
// language switch) and hands back only what the wiring here still calls.
const { renderPacketList, updatePacketControls } = initPacketUi({ state, els, getT: () => t });
const { populateFontSelect, applySettingsLimits, syncSettingsControlsFromState } = initSettingsPanelUi({
  state,
  els,
  defaultLetterColors: DEFAULT_LETTER_COLORS,
  requestRender,
  getT: () => t
});
const { populatePresetSelect } = initPresetsUi({
  state,
  els,
  getT: () => t,
  languages: LANGUAGES,
  defaultLetterColors: DEFAULT_LETTER_COLORS,
  switchLanguage,
  syncSettingsControlsFromState,
  updateCandidateCount,
  createText,
  requestRender
});
initContentImportUi({ state, els, getT: () => t, imagesById: IMAGES_BY_ID, installCatalog, updateCandidateCount });

/** Applies t() to every element carrying a data-label (text) or data-placeholder (input placeholder) key. */
function applyStaticLabels() {
  document.documentElement.lang = state.language;
  document.title = t('app.title');
  for (const el of document.querySelectorAll('[data-label]')) {
    el.textContent = t(el.dataset.label);
  }
  for (const el of document.querySelectorAll('[data-placeholder]')) {
    el.placeholder = t(el.dataset.placeholder);
  }
  for (const el of document.querySelectorAll('[data-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset.ariaLabel));
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

/** Language names (language.sl/en/de/fr/es) are identical across every locale file by design — each language names itself the same way regardless of interface language, the standard "endonym" convention. */
function populateLanguageSelect() {
  els.languageSelect.replaceChildren(
    ...LANGUAGES.map((language) => {
      const option = document.createElement('option');
      option.value = language;
      option.textContent = t(`language.${language}`);
      return option;
    })
  );
  els.languageSelect.value = state.language;
}

/**
 * Switches the active content pack and UI locale. Does not touch
 * theme/level (stable ids, valid across every language) or trigger a
 * re-render — callers decide whether/when to call createText().
 * @param {string} language
 */
function switchLanguage(language) {
  state.language = language;
  t = createTranslator(LOCALES[language]);
  CATALOG = CATALOGS[language];
  THEMES = listThemes(CATALOG);
  applyStaticLabels();
  populateLanguageSelect();
  populateThemeSelect();
  populatePresetSelect(); // built-in preset names are translated
  renderPacketList();
}

function updateLanguage(language) {
  switchLanguage(language);
  updateCandidateCount();
  resetCustomImage();
  createText();
}

/** Updates the "N texts available" indicator without touching the displayed worksheet — a filter change alone must never silently swap the visible passage (blueprint 8.2). */
function updateCandidateCount() {
  const candidates = findCandidates(CATALOG, state.filter);
  els.candidateCount.textContent = candidates.length > 0
    ? t('candidates.available', { count: candidates.length })
    : t('candidates.none');
  els.createButton.disabled = candidates.length === 0;
  populateTextSelect(candidates);
  return candidates;
}

/**
 * The title picker (upgrade blueprint v3, workstream I7): lists the current
 * cell's texts by title so a teacher can go straight to one instead of
 * clicking "Create text" through the cycle. Shown only when there is
 * something to choose between. Choosing a title shows that text at once;
 * "Create text" then continues from it in pack order.
 * @param {import('./content/validate.js').ContentEntry[]} candidates
 */
function populateTextSelect(candidates) {
  const select = els.textSelect;
  select.innerHTML = '';
  const show = candidates.length > 1;
  select.hidden = !show;
  els.textSelectLabel.hidden = !show;
  if (!show) return;
  for (const entry of candidates) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.title;
    select.appendChild(option);
  }
  syncTextSelect(candidates);
}

/** Reflects the displayed text in the picker; a filter change alone leaves the preview on a text from another cell, so nothing is selected then. */
function syncTextSelect(candidates = findCandidates(CATALOG, state.filter)) {
  if (els.textSelect.hidden) return;
  const shown = candidates.some((c) => c.id === state.contentId);
  els.textSelect.value = shown ? state.contentId : '';
  if (!shown) els.textSelect.selectedIndex = -1;
}

function showEntry(entry) {
  state.contentId = entry.id;
  resetCustomImage(); // a newly created text gets its own paired image, not the previous text's custom one
  syncTextSelect();
  requestRender();
}

function chooseTextById(id) {
  const entry = findCandidates(CATALOG, state.filter).find((c) => c.id === id);
  if (entry) showEntry(entry);
}

function updateFilter(partial) {
  Object.assign(state.filter, partial);
  updateCandidateCount();
}

function createText() {
  const candidates = findCandidates(CATALOG, state.filter);
  const entry = chooseEntry(candidates, state.contentId);
  if (!entry) return; // createButton is disabled in this case, but guard anyway
  showEntry(entry);
}

function updateWritingMode(mode) {
  state.settings.writingMode = mode;
  // Writing about the picture needs one: never silently print an empty
  // sheet (handbook §11.6 A4). The select's "None" is disabled meanwhile.
  if (mode === 'write-own' && state.settings.imageSlot === 'none') state.settings.imageSlot = 'picture';
  syncSettingsControlsFromState();
  if (state.contentId) requestRender();
}

function updateImageSlot(slot) {
  state.settings.imageSlot = slot;
  if (state.contentId) requestRender();
}

/** Clears the custom image without rendering — its other callers (createText, updateLanguage) go on to render themselves. */
function resetCustomImage() {
  state.customImage = null;
  els.imageUpload.value = '';
  els.resetImageButton.disabled = true;
  els.imageStatus.textContent = '';
}

/** The Reset button's own handler: the one caller that must trigger the render itself, or the preview and lastGood keep the uploaded image. */
function handleResetImage() {
  resetCustomImage();
  if (state.contentId) requestRender();
}

async function handleImageUpload(file) {
  if (!file) return;
  const result = await readImageFile(file);
  if (!result.ok) {
    els.imageStatus.textContent = t(`image.error.${result.code}`);
    els.imageUpload.value = '';
    return;
  }
  state.customImage = { id: 'custom', path: result.dataUrl, width: result.width, height: result.height };
  els.resetImageButton.disabled = false;
  els.imageStatus.textContent = t('image.replaced');
  if (state.contentId) requestRender();
}

/**
 * Renders the three-state fit result (upgrade blueprint v3, workstream A —
 * 'extends' is new; a worksheet longer than one page is now allowed and
 * clearly labelled instead of blocked).
 * @param {import('./worksheet/build.js').WorksheetModel} model
 * @param {import('./layout/measure.js').FitResult} result
 */
function showFit(model, result) {
  const el = els.fitIndicator;
  el.classList.toggle('is-overflow', result.status === 'blocked');
  el.classList.toggle('is-extends', result.status === 'extends');
  el.dataset.pageCount = result.pageCount ?? '';
  // The millimetre figures are a developer diagnostic, not teacher-facing
  // text (workstream I3) — kept here for the verify-* scripts and debugging.
  el.dataset.usedMm = result.heightsMm ? (result.heightsMm.final ?? result.heightsMm.used).toFixed(1) : '';
  el.dataset.budgetMm = result.heightsMm ? result.heightsMm.budget.toFixed(1) : '';

  const suggestions = (result.suggestions ?? []).map((code) => t(`fit.suggestion.${code}`)).join(', ');

  if (result.status === 'fits') {
    el.textContent = t('fit.fits', { words: model.wordCount, level: model.level });
  } else if (result.status === 'extends') {
    el.textContent = t('fit.extends', {
      pages: result.pageCount,
      words: model.wordCount,
      level: model.level,
      suggestions
    });
  } else {
    el.textContent = t('fit.blocked', {
      code: result.code,
      reason: t(`fit.blocked.reason.${result.code}`),
      suggestions
    });
  }
  showNotices(result.notices);
}

/** The last sheet's notice codes, unfiltered — re-shown when the view changes. */
let currentNoticeCodes = [];

/**
 * Advisory notices (worksheet/advice.js), one line each under the fit
 * indicator. They never block printing, so they sit outside the fit line.
 * GRAY_COLLISION is shown only while the grayscale preview is on: the
 * owner's palette always triggers it (b/d), and it is the moment the
 * teacher is asking how the sheet prints in grey (handbook §11.15).
 * @param {string[]} codes
 */
function showNotices(codes) {
  currentNoticeCodes = codes;
  const shown = codes.filter((code) => code !== 'GRAY_COLLISION' || state.view.grayscale);
  els.fitNotices.replaceChildren(
    ...shown.map((code) => {
      const li = document.createElement('li');
      li.dataset.notice = code;
      li.textContent = t(`notice.${code}`);
      return li;
    })
  );
  els.fitNotices.hidden = shown.length === 0;
}

/** View only: greys the on-screen preview; the print surface is never touched. */
function updateGrayscalePreview(enabled) {
  state.view.grayscale = enabled;
  els.preview.classList.toggle('is-grayscale', enabled);
  showNotices(currentNoticeCodes);
}

/** Nothing printable: clears the preview, the print surface and lastGood, and disables every output. */
function clearPrintableWorksheet() {
  state.lastGood = null;
  els.printButton.disabled = true;
  els.docxButton.disabled = true;
  els.preview.replaceChildren();
  els.printSurface.replaceChildren();
  updatePacketControls();
}

async function requestRender() {
  const revision = ++state.revision;
  try {
    const entry = CATALOG.byId.get(state.contentId);
    // A teacher-uploaded image overrides only this entry's mapping, for this
    // render — the shared IMAGES_BY_ID map itself is never mutated.
    const imagesById = state.customImage
      ? new Map(IMAGES_BY_ID).set(entry.imageId, state.customImage)
      : IMAGES_BY_ID;
    const model = buildWorksheet(entry, state.settings, { imagesById }, entry.language);

    const labels = sheetLabels(t);
    const result = await measureWorksheet(model, revision, labels);
    if (revision !== state.revision) return; // stale async result, discard

    showFit(model, result);
    els.printButton.disabled = !isPrintReady(result);
    els.docxButton.disabled = !isPrintReady(result);

    if (result.status === 'blocked') {
      clearPrintableWorksheet();
      return;
    }

    // previewMode (page-break markers) only in #preview — never the print
    // surface or a packet sheet (upgrade blueprint v3, workstream A).
    renderWorksheet(model, result.layout, els.preview, labels, true);
    renderWorksheet(model, result.layout, els.printSurface, labels);
    state.lastGood = { model, layout: result.layout, pageCount: result.pageCount };
    updatePacketControls();
  } catch (error) {
    // Before 0.10 an exception here left the previous worksheet on screen
    // with Print still enabled and only a console message — a sheet that
    // failed to build must never stay printable.
    if (revision !== state.revision) return;
    // eslint-disable-next-line no-console
    console.error('Worksheet could not be prepared:', error);
    clearPrintableWorksheet();
    els.fitIndicator.classList.add('is-overflow');
    els.fitIndicator.classList.remove('is-extends');
    els.fitIndicator.dataset.pageCount = '';
    els.fitIndicator.textContent = t('fit.internalError', { message: error.message });
    showNotices([]);
  }
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
    const labels = sheetLabels(t);
    const blob = await exportDocx(model, layout, imageBytes, labels);
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

els.languageSelect.addEventListener('change', (event) => updateLanguage(event.target.value));
els.themeSelect.addEventListener('change', (event) => updateFilter({ theme: event.target.value }));
els.levelSelect.addEventListener('change', (event) => updateFilter({ level: Number(event.target.value) }));
els.createButton.addEventListener('click', createText);
els.textSelect.addEventListener('change', () => chooseTextById(els.textSelect.value));
els.writingModeSelect.addEventListener('change', (event) => updateWritingMode(event.target.value));
els.imageSlotSelect.addEventListener('change', (event) => updateImageSlot(event.target.value));
els.printButton.addEventListener('click', printWorksheet);
els.docxButton.addEventListener('click', handleExportDocx);

els.imageUpload.addEventListener('change', (e) => handleImageUpload(e.target.files[0]));
els.resetImageButton.addEventListener('click', handleResetImage);
els.grayscalePreviewToggle.addEventListener('change', (e) => updateGrayscalePreview(e.target.checked));

applyStaticLabels();
populateLanguageSelect();
populateThemeSelect();
populateFontSelect();
updateCandidateCount();
applySettingsLimits();
syncSettingsControlsFromState();
// A reload can restore the checkbox's old state; the view always starts in colour.
els.grayscalePreviewToggle.checked = state.view.grayscale;
populatePresetSelect();
updatePacketControls();
renderPacketList();
if (!checkStorageCapability()) {
  els.storageStatus.textContent = t('preset.storageUnavailable');
  els.savePresetButton.disabled = true;
}
els.fitIndicator.textContent = t('fit.measuring');

// Scale the on-screen A4 preview down to fit the available width (never
// up). Display-only: the fit check measures in its own unscaled surface.
{
  const previewScroll = document.querySelector('.preview-scroll');
  const pageFrame = document.querySelector('.page-frame');
  const A4_WIDTH_PX = 210 * (96 / 25.4);
  const fitPreview = () => {
    const available = previewScroll.clientWidth - 16;
    const scale = Math.min(1, available / A4_WIDTH_PX);
    pageFrame.style.setProperty('--preview-scale', scale.toFixed(3));
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitPreview).observe(previewScroll);
  fitPreview();
}

createText(); // show something on first load rather than an empty preview
