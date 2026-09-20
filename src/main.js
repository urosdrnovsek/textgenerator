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
import { validateSettings, validatePresetSettings } from './worksheet/validateSettings.js';
import { SETTINGS_LIMITS, FONT_FAMILIES, DEFAULT_CHILD_NAME } from './config.js';
import { buildWorksheet } from './worksheet/build.js';
import { renderWorksheet } from './render/html.js';
import { measureWorksheet } from './layout/measure.js';
import { isPrintReady, printWorksheet } from './export/print.js';
import { exportDocx } from './export/docx.js';
import { createTranslator } from './i18n.js';
import {
  checkStorageCapability,
  listPresets,
  savePreset,
  deletePreset,
  exportPresetsToBlob,
  importPresetsFromJson,
  resetAllData
} from './storage.js';
import { readImageFile, readContentPackImport } from './import.js';
import { PACKET_MAX_SHEETS, addSnapshot, removeSnapshot, moveSnapshot, generateSnapshotId, totalPages } from './worksheet/packet.js';

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

const STANDARD_SETTINGS = {
  language: DEFAULT_LANGUAGE,
  theme: THEMES[0],
  level: 1,
  fontId: 'andika',
  fontSizePt: 16,
  lineHeightMultiplier: 1.4,
  letterSpacingPt: 0.3,
  extraWordSpacePt: 1,
  writingMode: 'read-copy',
  rulingId: 'standard-3line',
  guideHeightMm: 10,
  letterColors: DEFAULT_LETTER_COLORS,
  syllableMode: 'colors',
  syllableColors: ['#1D4ED8', '#B45309'],
  header: { nameLine: true, date: true, title: true },
  sentencePerLine: false,
  tintId: 'none',
  printTint: false,
  lineStripes: false,
  printStripes: false,
  marginMm: 20
};

/**
 * Built-in presets always exist, independent of localStorage (blueprint
 * 8.10: "a couple of sensible built-in presets out of the box"). A
 * function, not a module-level const: its names must re-translate when the
 * teacher switches the interface language.
 */
function getBuiltInPresets() {
  return [
    { id: 'builtin-standard', name: t('preset.builtin.standard'), builtin: true, settings: STANDARD_SETTINGS },
    {
      id: 'builtin-dyslexia',
      name: t('preset.builtin.dyslexia'),
      builtin: true,
      settings: {
        ...STANDARD_SETTINGS,
        fontSizePt: DYSLEXIA_PRESET.fontSizePt,
        lineHeightMultiplier: DYSLEXIA_PRESET.lineHeightMultiplier,
        letterSpacingPt: DYSLEXIA_PRESET.letterSpacingPt,
        extraWordSpacePt: DYSLEXIA_PRESET.extraWordSpacePt
      }
    }
  ];
}

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
    header: { nameLine: true, date: true, title: true },
    personalization: { name: '' },
    sentencePerLine: false,
    tintId: 'none',
    printTint: false,
    lineStripes: false,
    printStripes: false,
    marginMm: 20
  },
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
  printButton: document.getElementById('btn-print'),
  docxButton: document.getElementById('btn-docx'),
  createButton: document.getElementById('btn-create'),
  nameInput: document.getElementById('name-input'),
  languageSelect: document.getElementById('language-select'),
  themeSelect: document.getElementById('theme-select'),
  levelSelect: document.getElementById('level-select'),
  writingModeSelect: document.getElementById('writing-mode-select'),
  candidateCount: document.getElementById('candidate-count'),
  fontSelect: document.getElementById('font-select'),
  fontSizeInput: document.getElementById('font-size-input'),
  lineHeightInput: document.getElementById('line-height-input'),
  letterSpacingInput: document.getElementById('letter-spacing-input'),
  wordSpacingInput: document.getElementById('word-spacing-input'),
  letterColorsToggle: document.getElementById('letter-colors-toggle'),
  syllableColorsToggle: document.getElementById('syllable-colors-toggle'),
  syllableSeparatorsToggle: document.getElementById('syllable-separators-toggle'),
  sentencePerLineToggle: document.getElementById('sentence-per-line-toggle'),
  tintSelect: document.getElementById('tint-select'),
  printTintToggle: document.getElementById('print-tint-toggle'),
  lineStripesToggle: document.getElementById('line-stripes-toggle'),
  printStripesToggle: document.getElementById('print-stripes-toggle'),
  headerNameLineToggle: document.getElementById('header-nameline-toggle'),
  headerDateToggle: document.getElementById('header-date-toggle'),
  headerTitleToggle: document.getElementById('header-title-toggle'),
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

/** Applies t() to every element carrying a data-label (text) or data-placeholder (input placeholder) key. */
function applyStaticLabels() {
  document.documentElement.lang = state.language;
  document.title = t('app.title');
  for (const el of document.querySelectorAll('[data-label]')) {
    el.textContent = t(el.dataset.label);
  }
  for (const el of document.querySelectorAll('[data-placeholder]')) {
    // requestRender() immediately refines name-input's placeholder to the
    // current entry's own name_default; this generic fallback only shows
    // briefly before the first render, or for an entry with no {name} use.
    el.placeholder = t(el.dataset.placeholder, { name: DEFAULT_CHILD_NAME });
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
  renderPacketList();
}

function updateLanguage(language) {
  switchLanguage(language);
  updateCandidateCount();
  resetCustomImage();
  createText();
}

/** Font names (Andika, Lexend, ...) are proper nouns — shown as-is, not translated. */
function populateFontSelect() {
  els.fontSelect.replaceChildren(
    ...Object.entries(FONT_FAMILIES).map(([fontId, displayName]) => {
      const option = document.createElement('option');
      option.value = fontId;
      option.textContent = displayName;
      return option;
    })
  );
}

function updateFontId(fontId) {
  state.settings.fontId = fontId;
  if (state.contentId) requestRender();
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
  resetCustomImage(); // a newly created text gets its own paired image, not the previous text's custom one
  requestRender();
}

function updateWritingMode(mode) {
  state.settings.writingMode = mode;
  if (state.contentId) requestRender();
}

/** Strips syllable/placeholder-marker characters a typed name could otherwise inject into syllable_body once substituted (upgrade blueprint v3, workstream B). */
function sanitizePersonalizationName(name) {
  return name.replace(/[|{}]/g, '');
}

function updatePersonalizationName(inputEl) {
  const sanitized = sanitizePersonalizationName(inputEl.value);
  inputEl.value = sanitized; // reflect the stripped value back — the box must never show characters that aren't actually applied
  state.settings.personalization.name = sanitized;
  if (state.contentId) requestRender();
}

function resetCustomImage() {
  state.customImage = null;
  els.imageUpload.value = '';
  els.resetImageButton.disabled = true;
  els.imageStatus.textContent = '';
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
  els.guideHeightInput.min = SETTINGS_LIMITS.guideHeightMm.min;
  els.guideHeightInput.max = SETTINGS_LIMITS.guideHeightMm.max;
}

/** Reflects state.settings into the settings-panel controls — used at startup and after applying a preset. */
function syncSettingsControlsFromState() {
  const s = state.settings;
  els.fontSelect.value = s.fontId;
  els.fontSizeInput.value = s.fontSizePt;
  els.lineHeightInput.value = s.lineHeightMultiplier;
  els.letterSpacingInput.value = s.letterSpacingPt;
  els.wordSpacingInput.value = s.extraWordSpacePt;
  els.letterColorsToggle.checked = Object.keys(s.letterColors).length > 0;
  els.syllableColorsToggle.checked = s.syllableMode === 'colors' || s.syllableMode === 'both';
  els.syllableSeparatorsToggle.checked = s.syllableMode === 'separators' || s.syllableMode === 'both';
  els.sentencePerLineToggle.checked = Boolean(s.sentencePerLine);
  els.tintSelect.value = s.tintId ?? 'none';
  els.printTintToggle.checked = Boolean(s.printTint);
  els.printTintToggle.disabled = (s.tintId ?? 'none') === 'none';
  els.lineStripesToggle.checked = Boolean(s.lineStripes);
  els.printStripesToggle.checked = Boolean(s.printStripes);
  els.printStripesToggle.disabled = !s.lineStripes;
  els.headerNameLineToggle.checked = Boolean(s.header.nameLine);
  els.headerDateToggle.checked = Boolean(s.header.date);
  els.headerTitleToggle.checked = Boolean(s.header.title);
  els.guideHeightInput.value = s.guideHeightMm;
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

/** Colors and separators are independently toggleable (brief section 5: "and/or") — this reads both checkboxes to derive the single syllableMode value the rest of the app expects. */
function updateSyllableMode() {
  const colors = els.syllableColorsToggle.checked;
  const separators = els.syllableSeparatorsToggle.checked;
  state.settings.syllableMode = colors && separators ? 'both' : colors ? 'colors' : separators ? 'separators' : 'off';
  if (state.contentId) requestRender();
}

function updateSentencePerLine(enabled) {
  state.settings.sentencePerLine = enabled;
  if (state.contentId) requestRender();
}

function updateTint(tintId) {
  state.settings.tintId = tintId;
  els.printTintToggle.disabled = tintId === 'none';
  if (state.contentId) requestRender();
}

function updatePrintTint(enabled) {
  state.settings.printTint = enabled;
  if (state.contentId) requestRender();
}

function updateLineStripes(enabled) {
  state.settings.lineStripes = enabled;
  els.printStripesToggle.disabled = !enabled;
  if (state.contentId) requestRender();
}

function updatePrintStripes(enabled) {
  state.settings.printStripes = enabled;
  if (state.contentId) requestRender();
}

/** Header field toggles (upgrade blueprint v3, workstream D6) — the model and both exporters already supported these; this just exposes them in the settings panel. */
function updateHeaderField(field, enabled) {
  state.settings.header[field] = enabled;
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

/** Everything a preset should capture. Deliberately excludes personalization.name — presets are reusable setups shared across children, not tied to one child's saved worksheet (blueprint 8.10, section 15). */
function extractPresetSettings() {
  const s = state.settings;
  return {
    language: state.language,
    theme: state.filter.theme,
    level: state.filter.level,
    fontId: s.fontId,
    fontSizePt: s.fontSizePt,
    lineHeightMultiplier: s.lineHeightMultiplier,
    letterSpacingPt: s.letterSpacingPt,
    extraWordSpacePt: s.extraWordSpacePt,
    writingMode: s.writingMode,
    rulingId: s.rulingId,
    guideHeightMm: s.guideHeightMm,
    letterColors: s.letterColors,
    syllableMode: s.syllableMode,
    syllableColors: s.syllableColors,
    header: s.header,
    sentencePerLine: s.sentencePerLine,
    tintId: s.tintId,
    printTint: s.printTint,
    lineStripes: s.lineStripes,
    printStripes: s.printStripes,
    marginMm: s.marginMm
  };
}

/**
 * Applies a preset's settings after validating them (upgrade blueprint v3,
 * workstream D2) — protects against a preset that was hand-edited, saved by
 * a different app version, or corrupted in localStorage, which would
 * otherwise reach layout/measure.js later and throw instead of failing with
 * a clear message.
 * @param {unknown} settings
 */
function applyPresetSettings(settings) {
  const validation = validatePresetSettings(settings);
  if (!validation.ok) {
    // eslint-disable-next-line no-console
    console.error('Preset failed validation, not applied:', validation.errors);
    els.storageStatus.textContent = t('preset.invalid');
    return;
  }
  els.storageStatus.textContent = '';

  if (settings.language && settings.language !== state.language && LANGUAGES.includes(settings.language)) {
    switchLanguage(settings.language);
  }
  state.filter.theme = settings.theme;
  state.filter.level = settings.level;
  Object.assign(state.settings, {
    fontId: settings.fontId,
    fontSizePt: settings.fontSizePt,
    lineHeightMultiplier: settings.lineHeightMultiplier,
    letterSpacingPt: settings.letterSpacingPt,
    extraWordSpacePt: settings.extraWordSpacePt,
    writingMode: settings.writingMode,
    rulingId: settings.rulingId,
    guideHeightMm: settings.guideHeightMm,
    letterColors: settings.letterColors,
    syllableMode: settings.syllableMode,
    syllableColors: settings.syllableColors,
    header: settings.header,
    sentencePerLine: settings.sentencePerLine ?? false,
    tintId: settings.tintId ?? 'none',
    printTint: settings.printTint ?? false,
    lineStripes: settings.lineStripes ?? false,
    printStripes: settings.printStripes ?? false,
    marginMm: settings.marginMm
    // personalization is left untouched — loading a setup must not erase a name already typed in
  });

  els.themeSelect.value = state.filter.theme;
  els.levelSelect.value = String(state.filter.level);
  els.writingModeSelect.value = state.settings.writingMode;
  syncSettingsControlsFromState();
  updateCandidateCount();
  createText();
}

function getAllPresets() {
  return [...getBuiltInPresets(), ...listPresets()];
}

function populatePresetSelect() {
  const previousValue = els.presetSelect.value;
  els.presetSelect.replaceChildren(
    ...getAllPresets().map((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      return option;
    })
  );
  if ([...els.presetSelect.options].some((o) => o.value === previousValue)) {
    els.presetSelect.value = previousValue;
  }
}

function handleLoadPreset() {
  const preset = getAllPresets().find((p) => p.id === els.presetSelect.value);
  if (preset) applyPresetSettings(preset.settings);
}

function handleDeletePreset() {
  const preset = getAllPresets().find((p) => p.id === els.presetSelect.value);
  if (!preset) return;
  if (preset.builtin) {
    els.storageStatus.textContent = t('preset.deleteBuiltinBlocked');
    return;
  }
  deletePreset(preset.id);
  els.storageStatus.textContent = '';
  populatePresetSelect();
}

function handleSavePreset() {
  const name = prompt(t('preset.namePrompt'));
  if (!name || !name.trim()) return;
  const result = savePreset(name.trim(), extractPresetSettings());
  if (!result.ok) {
    els.storageStatus.textContent = t('preset.saveFailed');
    return;
  }
  els.storageStatus.textContent = '';
  populatePresetSelect();
  els.presetSelect.value = result.preset.id;
}

function handleExportSetups() {
  const blob = exportPresetsToBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'worksheet-setups.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function handleImportSetups(file) {
  if (!file) return;
  const text = await file.text();
  const result = importPresetsFromJson(text);
  els.importSetupsInput.value = '';
  if (!result.ok) {
    els.storageStatus.textContent = t(`setup.import.error.${result.error}`);
    return;
  }
  els.storageStatus.textContent = result.skipped.length > 0
    ? t('setup.import.successWithSkipped', { count: result.imported, skipped: result.skipped.length })
    : t('setup.import.success', { count: result.imported });
  if (result.skipped.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Some imported setups failed validation and were skipped:', result.skipped);
  }
  populatePresetSelect();
}

function handleResetData() {
  // eslint-disable-next-line no-alert
  if (!confirm(t('reset.confirm'))) return;
  const ok = resetAllData();
  if (!ok) {
    els.storageStatus.textContent = t('preset.storageUnavailable');
    return;
  }
  populatePresetSelect();
  els.storageStatus.textContent = t('reset.done');
}

/** Reflects state.packet into the sidebar list/buttons — pure DOM sync, no state changes. */
function renderPacketList() {
  if (state.packet.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'packet-empty';
    empty.textContent = t('packet.empty');
    els.packetList.replaceChildren(empty);
    return;
  }
  els.packetList.replaceChildren(
    ...state.packet.map((sheet, index) => {
      const li = document.createElement('li');

      const titleSpan = document.createElement('span');
      titleSpan.className = 'packet-item-title';
      const pagesSuffix = sheet.pageCount > 1 ? ` — ${t('packet.sheetPages', { pages: sheet.pageCount })}` : '';
      titleSpan.textContent = `${index + 1}. ${sheet.title} — ${t(`language.${sheet.language}`)}, ${t('field.level')} ${sheet.level}${pagesSuffix}`;
      li.append(titleSpan);

      const upButton = document.createElement('button');
      upButton.type = 'button';
      upButton.textContent = '↑';
      upButton.title = t('action.moveUp');
      upButton.disabled = index === 0;
      upButton.addEventListener('click', () => {
        state.packet = moveSnapshot(state.packet, sheet.id, -1);
        renderPacketList();
      });
      li.append(upButton);

      const downButton = document.createElement('button');
      downButton.type = 'button';
      downButton.textContent = '↓';
      downButton.title = t('action.moveDown');
      downButton.disabled = index === state.packet.length - 1;
      downButton.addEventListener('click', () => {
        state.packet = moveSnapshot(state.packet, sheet.id, 1);
        renderPacketList();
      });
      li.append(downButton);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '✕';
      removeButton.title = t('action.removeFromPacket');
      removeButton.addEventListener('click', () => {
        state.packet = removeSnapshot(state.packet, sheet.id);
        updatePacketControls();
        renderPacketList();
      });
      li.append(removeButton);

      return li;
    })
  );
}

function updatePacketControls() {
  els.packetCount.textContent = t('packet.count', {
    count: state.packet.length,
    max: PACKET_MAX_SHEETS,
    pages: totalPages(state.packet)
  });
  els.addToPacketButton.disabled = !state.lastGood || state.packet.length >= PACKET_MAX_SHEETS;
  els.printPacketButton.disabled = state.packet.length === 0;
  els.clearPacketButton.disabled = state.packet.length === 0;
}

function handleAddToPacket() {
  if (!state.lastGood) return;
  const { model, layout, pageCount } = state.lastGood;
  const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
  const result = addSnapshot(state.packet, {
    id: generateSnapshotId(),
    title: model.title,
    language: model.contentKey.language,
    level: model.level,
    pageCount,
    model,
    layout,
    labels
  });
  if (!result.ok) {
    els.packetStatus.textContent = t('packet.full', { max: PACKET_MAX_SHEETS });
    return;
  }
  state.packet = result.packet;
  els.packetStatus.textContent = '';
  updatePacketControls();
  renderPacketList();
}

function handleClearPacket() {
  state.packet = [];
  updatePacketControls();
  renderPacketList();
}

/**
 * Prints every packet snapshot as its own page, in order. Each snapshot was
 * only ever added once it was already a print-ready worksheet, and the
 * frozen model/layout/labels can't have changed since — so there is nothing
 * left to re-measure here, only to re-render (blueprint 8.10: "Recheck
 * every sheet before printing" is satisfied by re-rendering from the
 * immutable snapshot rather than trusting stale DOM).
 */
function handlePrintPacket() {
  if (state.packet.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const sheet of state.packet) {
    const container = document.createElement('div');
    renderWorksheet(sheet.model, sheet.layout, container, sheet.labels);
    fragment.append(...container.children);
  }
  els.printSurface.replaceChildren(fragment);
  printWorksheet();
  // Restore the print surface to the currently displayed single worksheet
  // so a subsequent plain "Print" click reflects what's on screen again.
  if (state.lastGood) {
    const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
    renderWorksheet(state.lastGood.model, state.lastGood.layout, els.printSurface, labels);
  }
}

function describeImportError(result) {
  if (result.code === 'INVALID_JSON') return t('error.INVALID_JSON');
  if (result.code === 'IMAGE_READ_FAILED') return t('import.error.IMAGE_READ_FAILED', { filename: result.imageError.filename });
  const first = result.errors[0];
  return t('import.error.VALIDATION_FAILED', {
    count: result.errors.length,
    entryId: first.entryId,
    field: first.field,
    message: first.message
  });
}

/**
 * Teacher-driven content extension without coding (blueprint 8.11):
 * validates the selected JSON + any new images together, then — all or
 * nothing — replaces that language's catalog for the rest of this session.
 * Imported packs are session-resident only, never written back to disk
 * (blueprint 8.11: "Imported packs are session-resident initially").
 */
async function handleImportContent() {
  const jsonFile = els.importJsonInput.files[0];
  if (!jsonFile) return;
  const imageFiles = [...els.importImagesInput.files];
  const result = await readContentPackImport(jsonFile, imageFiles, new Set(IMAGES_BY_ID.keys()));
  if (!result.ok) {
    els.importStatus.textContent = describeImportError(result);
    return;
  }

  for (const [id, image] of result.images) IMAGES_BY_ID.set(id, image);
  const entriesWithLanguage = result.pack.entries.map((entry) => ({ ...entry, language: result.pack.language }));
  CATALOGS[result.pack.language] = buildCatalogIndex(entriesWithLanguage);

  els.importStatus.textContent = t('import.success', {
    count: result.pack.entries.length,
    language: t(`language.${result.pack.language}`)
  });
  els.importJsonInput.value = '';
  els.importImagesInput.value = '';

  if (result.pack.language === state.language) {
    CATALOG = CATALOGS[state.language];
    THEMES = listThemes(CATALOG);
    populateThemeSelect();
    state.contentId = null;
    state.lastGood = null;
    els.preview.replaceChildren();
    els.printSurface.replaceChildren();
    els.printButton.disabled = true;
    els.docxButton.disabled = true;
    updateCandidateCount();
    els.fitIndicator.textContent = t('preview.empty');
  }
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

  const suggestions = (result.suggestions ?? []).map((code) => t(`fit.suggestion.${code}`)).join(', ');

  if (result.status === 'fits') {
    el.textContent = t('fit.fits', {
      words: model.wordCount,
      level: model.level,
      used: (result.heightsMm.final ?? result.heightsMm.used).toFixed(1),
      budget: result.heightsMm.budget.toFixed(1)
    });
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
}

async function requestRender() {
  const revision = ++state.revision;
  const entry = CATALOG.byId.get(state.contentId);
  // The placeholder hints at the name this entry will actually use if the
  // field is left empty (upgrade blueprint v3, workstream B) — entries with
  // no {name} placeholder fall back to the generic default.
  els.nameInput.placeholder = t('field.childNamePlaceholder', { name: entry.name_default ?? DEFAULT_CHILD_NAME });
  // A teacher-uploaded image overrides only this entry's mapping, for this
  // render — the shared IMAGES_BY_ID map itself is never mutated.
  const imagesById = state.customImage
    ? new Map(IMAGES_BY_ID).set(entry.imageId, state.customImage)
    : IMAGES_BY_ID;
  const model = buildWorksheet(entry, state.settings, { imagesById }, entry.language);

  const result = await measureWorksheet(model, revision);
  if (revision !== state.revision) return; // stale async result, discard

  showFit(model, result);
  els.printButton.disabled = !isPrintReady(result);
  els.docxButton.disabled = !isPrintReady(result);

  if (result.status === 'blocked') {
    state.lastGood = null;
    els.preview.replaceChildren();
    els.printSurface.replaceChildren();
    updatePacketControls();
    return;
  }

  const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
  // previewMode (page-break markers) only in #preview — never the print
  // surface or a packet sheet (upgrade blueprint v3, workstream A).
  renderWorksheet(model, result.layout, els.preview, labels, true);
  renderWorksheet(model, result.layout, els.printSurface, labels);
  state.lastGood = { model, layout: result.layout, pageCount: result.pageCount };
  updatePacketControls();
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
    const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
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
els.nameInput.addEventListener('change', (event) => updatePersonalizationName(event.target));
els.writingModeSelect.addEventListener('change', (event) => updateWritingMode(event.target.value));
els.printButton.addEventListener('click', printWorksheet);
els.docxButton.addEventListener('click', handleExportDocx);

els.fontSelect.addEventListener('change', (e) => updateFontId(e.target.value));
els.fontSizeInput.addEventListener('change', (e) => updateNumericSetting('fontSizePt', SETTINGS_LIMITS.fontSizePt, e.target));
els.lineHeightInput.addEventListener('change', (e) => updateNumericSetting('lineHeightMultiplier', SETTINGS_LIMITS.lineHeightMultiplier, e.target));
els.letterSpacingInput.addEventListener('change', (e) => updateNumericSetting('letterSpacingPt', SETTINGS_LIMITS.letterSpacingPt, e.target));
els.wordSpacingInput.addEventListener('change', (e) => updateNumericSetting('extraWordSpacePt', SETTINGS_LIMITS.extraWordSpacePt, e.target));
els.letterColorsToggle.addEventListener('change', (e) => updateLetterColorsEnabled(e.target.checked));
els.syllableColorsToggle.addEventListener('change', updateSyllableMode);
els.syllableSeparatorsToggle.addEventListener('change', updateSyllableMode);
els.sentencePerLineToggle.addEventListener('change', (e) => updateSentencePerLine(e.target.checked));
els.tintSelect.addEventListener('change', (e) => updateTint(e.target.value));
els.printTintToggle.addEventListener('change', (e) => updatePrintTint(e.target.checked));
els.lineStripesToggle.addEventListener('change', (e) => updateLineStripes(e.target.checked));
els.printStripesToggle.addEventListener('change', (e) => updatePrintStripes(e.target.checked));
els.headerNameLineToggle.addEventListener('change', (e) => updateHeaderField('nameLine', e.target.checked));
els.headerDateToggle.addEventListener('change', (e) => updateHeaderField('date', e.target.checked));
els.headerTitleToggle.addEventListener('change', (e) => updateHeaderField('title', e.target.checked));
els.guideHeightInput.addEventListener('change', (e) => updateNumericSetting('guideHeightMm', SETTINGS_LIMITS.guideHeightMm, e.target));
els.dyslexiaPresetButton.addEventListener('click', applyDyslexiaPreset);
els.loadPresetButton.addEventListener('click', handleLoadPreset);
els.deletePresetButton.addEventListener('click', handleDeletePreset);
els.savePresetButton.addEventListener('click', handleSavePreset);
els.imageUpload.addEventListener('change', (e) => handleImageUpload(e.target.files[0]));
els.resetImageButton.addEventListener('click', resetCustomImage);

els.exportSetupsButton.addEventListener('click', handleExportSetups);
els.importSetupsInput.addEventListener('change', (e) => handleImportSetups(e.target.files[0]));
els.resetDataButton.addEventListener('click', handleResetData);

els.addToPacketButton.addEventListener('click', handleAddToPacket);
els.printPacketButton.addEventListener('click', handlePrintPacket);
els.clearPacketButton.addEventListener('click', handleClearPacket);

els.importContentButton.addEventListener('click', handleImportContent);

applyStaticLabels();
populateLanguageSelect();
populateThemeSelect();
populateFontSelect();
updateCandidateCount();
applySettingsLimits();
syncSettingsControlsFromState();
populatePresetSelect();
updatePacketControls();
renderPacketList();
if (!checkStorageCapability()) {
  els.storageStatus.textContent = t('preset.storageUnavailable');
  els.savePresetButton.disabled = true;
}
els.fitIndicator.textContent = t('fit.measuring');
createText(); // show something on first load rather than an empty preview
