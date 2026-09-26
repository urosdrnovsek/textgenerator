/**
 * Presets coordinator: the two built-in formatting presets, teacher-saved
 * setups (save/load/delete), setup backup export/import, and "Reset saved
 * data". Extracted verbatim from main.js (0.8.1, workstream J1). Storage
 * itself stays in storage.js; validation in worksheet/validateSettings.js.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * `getT` is a getter because main.js reassigns its translator on every
 * language switch (built-in preset names must re-translate).
 */

import { validatePresetSettings } from '../worksheet/validateSettings.js';
import {
  listPresets,
  savePreset,
  deletePreset,
  exportPresetsToBlob,
  importPresetsFromJson,
  resetAllData
} from '../storage.js';

/**
 * @param {object} ctx
 * @param {object} ctx.state the single mutable app state (main.js)
 * @param {Record<string, HTMLElement>} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {string[]} ctx.languages ids of the bundled languages
 * @param {Record<string, string>} ctx.defaultLetterColors
 * @param {(language: string) => void} ctx.switchLanguage
 * @param {() => void} ctx.syncSettingsControlsFromState
 * @param {() => void} ctx.updateCandidateCount
 * @param {() => void} ctx.createText
 * @param {() => void} ctx.requestRender
 * @returns {{ populatePresetSelect: () => void }}
 */
export function init({
  state,
  els,
  getT,
  languages: LANGUAGES,
  defaultLetterColors: DEFAULT_LETTER_COLORS,
  switchLanguage,
  syncSettingsControlsFromState,
  updateCandidateCount,
  createText,
  requestRender
}) {
  const t = (key, vars) => getT()(key, vars);

  /**
   * The two built-in presets are *formatting* presets: no language, theme,
   * level, or text. A teacher-saved setup (extractPresetSettings) is a full
   * setup and does carry those, and restoring them is the point of saving
   * one. Until 0.8.1 the built-ins carried the app's default language too,
   * so loading "Standard" in an English session switched the whole app back
   * to Slovene and replaced the current text (upgrade blueprint v3, H).
   */
  const STANDARD_FORMATTING = {
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
    header: { nameLine: true, date: true, title: true, instructions: true },
    sentencePerLine: false,
    tintId: 'none',
    printTint: false,
    lineStripes: false,
    printStripes: false,
    lineNumbers: false,
    imageSlot: 'picture',
    graphemes: [],
    marginMm: 20
  };

  /** blueprint 8.6: "a Dyslexia-friendly preset as an adjustable starting point" (Andika, larger type, ~1.6 line spacing, modest spacing) — a starting combination, not a claim of clinical efficacy. */
  const DYSLEXIA_FORMATTING = {
    ...STANDARD_FORMATTING,
    fontSizePt: 18,
    lineHeightMultiplier: 1.6,
    letterSpacingPt: 0.5,
    extraWordSpacePt: 1.5
  };

  /**
   * Built-in presets always exist, independent of localStorage (blueprint
   * 8.10: "a couple of sensible built-in presets out of the box"). A
   * function, not a module-level const: its names must re-translate when the
   * teacher switches the interface language.
   */
  function getBuiltInPresets() {
    return [
      { id: 'builtin-standard', name: t('preset.builtin.standard'), builtin: true, settings: STANDARD_FORMATTING },
      { id: 'builtin-dyslexia', name: t('preset.builtin.dyslexia'), builtin: true, settings: DYSLEXIA_FORMATTING }
    ];
  }

  /** The one-click button is the same thing as loading the built-in "Dyslexia-friendly" preset — one code path, so the two can't drift. */
  function applyDyslexiaPreset() {
    applyPresetSettings(DYSLEXIA_FORMATTING, { keepSelection: true });
  }

  /** Everything a preset should capture. */
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
      lineNumbers: s.lineNumbers,
      imageSlot: s.imageSlot,
      graphemes: s.graphemes,
      marginMm: s.marginMm
    };
  }

  /**
   * Applies a preset's settings after validating them (upgrade blueprint v3,
   * workstream D2) — protects against a preset that was hand-edited, saved by
   * a different app version, or corrupted in localStorage, which would
   * otherwise reach layout/measure.js later and throw instead of failing with
   * a clear message.
   *
   * `keepSelection` (built-in formatting presets and the Dyslexia button):
   * the current language, theme, level and text all stay; only formatting
   * changes, and the current worksheet is re-rendered. Without it (a
   * teacher-saved setup): language/theme/level are restored and a text is
   * created for them, which is what saving a setup is for.
   * @param {unknown} settings
   * @param {{ keepSelection?: boolean }} [options]
   */
  function applyPresetSettings(settings, { keepSelection = false } = {}) {
    // Built-in presets carry no selection; fill it from the current state so
    // the same validator serves both kinds.
    const full = keepSelection
      ? { ...settings, language: state.language, theme: state.filter.theme, level: state.filter.level }
      : settings;
    const validation = validatePresetSettings(full);
    if (!validation.ok) {
      // eslint-disable-next-line no-console
      console.error('Preset failed validation, not applied:', validation.errors);
      els.storageStatus.textContent = t('preset.invalid');
      return;
    }
    els.storageStatus.textContent = '';

    if (!keepSelection) {
      if (full.language !== state.language && LANGUAGES.includes(full.language)) {
        switchLanguage(full.language);
      }
      state.filter.theme = full.theme;
      state.filter.level = full.level;
    }
    // structuredClone: the preset's nested header/letterColors/syllableColors
    // must not become state.settings' own objects — the settings panel
    // mutates those in place, which would otherwise silently rewrite the
    // preset (a module constant, for the built-ins) for the rest of the
    // session. Same aliasing class as the packet-snapshot bug.
    Object.assign(state.settings, structuredClone({
      fontId: full.fontId,
      fontSizePt: full.fontSizePt,
      lineHeightMultiplier: full.lineHeightMultiplier,
      letterSpacingPt: full.letterSpacingPt,
      extraWordSpacePt: full.extraWordSpacePt,
      writingMode: full.writingMode,
      rulingId: full.rulingId,
      guideHeightMm: full.guideHeightMm,
      letterColors: full.letterColors,
      syllableMode: full.syllableMode,
      syllableColors: full.syllableColors,
      header: full.header,
      sentencePerLine: full.sentencePerLine ?? false,
      tintId: full.tintId ?? 'none',
      printTint: full.printTint ?? false,
      lineStripes: full.lineStripes ?? false,
      printStripes: full.printStripes ?? false,
      lineNumbers: full.lineNumbers ?? false,
      imageSlot: full.imageSlot ?? 'picture',
      graphemes: full.graphemes ?? [],
      marginMm: full.marginMm
    }));

    els.themeSelect.value = state.filter.theme;
    els.levelSelect.value = String(state.filter.level);
    els.writingModeSelect.value = state.settings.writingMode;
    syncSettingsControlsFromState();
    if (keepSelection) {
      if (state.contentId) requestRender();
    } else {
      updateCandidateCount();
      createText();
    }
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
    if (preset) applyPresetSettings(preset.settings, { keepSelection: Boolean(preset.builtin) });
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

  els.dyslexiaPresetButton.addEventListener('click', applyDyslexiaPreset);
  els.loadPresetButton.addEventListener('click', handleLoadPreset);
  els.deletePresetButton.addEventListener('click', handleDeletePreset);
  els.savePresetButton.addEventListener('click', handleSavePreset);
  els.exportSetupsButton.addEventListener('click', handleExportSetups);
  els.importSetupsInput.addEventListener('change', (e) => handleImportSetups(e.target.files[0]));
  els.resetDataButton.addEventListener('click', handleResetData);

  return { populatePresetSelect };
}
