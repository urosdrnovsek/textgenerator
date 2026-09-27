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
import { LANGUAGE_CODES } from '../languages.js';
import { DEFAULT_SETTINGS } from '../config.js';

/** Every setting a setup stores: the keys of the defaults (config.js). */
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

/**
 * What a sheet is for rather than how it looks: the built-in setups, being
 * formatting only, leave these as they are (until 0.10.0-rc.2 the
 * Dyslexia-friendly button switched a gap-fill sheet back to read & copy).
 */
const ACTIVITY_SETTING_KEYS = ['writingMode', 'copyTarget', 'imageSlot', 'clozeWordBank'];
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
 * @param {import('../main.js').AppState} ctx.state the single mutable app state (main.js)
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {(language: string) => void} ctx.switchLanguage
 * @param {() => void} ctx.syncSettingsControlsFromState
 * @param {() => void} ctx.updateCandidateCount
 * @param {() => void} ctx.createText
 * @param {() => void} ctx.requestRender
 * @param {() => void} ctx.forgetOwnTexts "Reset saved data" also removed the teacher's own texts
 * @returns {{ populatePresetSelect: () => void }}
 */
export function init({
  state,
  els,
  getT,
  switchLanguage,
  syncSettingsControlsFromState,
  updateCandidateCount,
  createText,
  requestRender,
  forgetOwnTexts
}) {
  const t = (key, vars) => getT()(key, vars);

  /**
   * The two built-in presets are *formatting* presets: no language, theme,
   * level, or text. A teacher-saved setup (extractPresetSettings) is a full
   * setup and does carry those, and restoring them is the point of saving
   * one. Until 0.8.1 the built-ins carried the app's default language too,
   * so loading "Standard" in an English session switched the whole app back
   * to Slovene and replaced the current text (upgrade blueprint v3, H).
   * "Standard" is simply the defaults a new sheet starts with.
   */
  const STANDARD_FORMATTING = DEFAULT_SETTINGS;

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

  /**
   * Everything a setup captures: what is shown, and every setting.
   * @returns {import('../storage.js').Preset['settings']}
   */
  function extractPresetSettings() {
    const settings = /** @type {import('../worksheet/build.js').WorksheetSettings} */ (
      Object.fromEntries(SETTING_KEYS.map((key) => [key, state.settings[key]]))
    );
    return { language: state.language, theme: state.filter.theme, level: state.filter.level, ...settings };
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
   * @param {Record<string, any>} settings untrusted (a stored or imported setup): validated below
   * @param {{ keepSelection?: boolean }} [options]
   */
  function applyPresetSettings(settings, { keepSelection = false } = {}) {
    // Built-in presets carry no selection, and leave the activity alone;
    // both come from the current state, so one validator serves both kinds.
    const full = keepSelection
      ? {
          ...settings,
          language: state.language,
          theme: state.filter.theme,
          level: state.filter.level,
          ...Object.fromEntries(ACTIVITY_SETTING_KEYS.map((key) => [key, state.settings[key]]))
        }
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
      if (full.language !== state.language && LANGUAGE_CODES.includes(full.language)) {
        switchLanguage(full.language);
      }
      state.filter.theme = full.theme;
      state.filter.level = full.level;
    }
    // structuredClone: the preset's nested header/letterColors/syllableColors
    // must not become state.settings' own objects — the settings panel
    // mutates those in place, which would otherwise silently rewrite the
    // preset (a module constant, for the built-ins) for the rest of the
    // session. Same aliasing class as the packet-snapshot bug. A setting
    // missing from an older setup takes its default.
    Object.assign(state.settings, structuredClone(
      Object.fromEntries(SETTING_KEYS.map((key) => [key, full[key] ?? DEFAULT_SETTINGS[key]]))
    ));

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
    forgetOwnTexts();
    els.storageStatus.textContent = t('reset.done');
  }

  els.dyslexiaPresetButton.addEventListener('click', applyDyslexiaPreset);
  els.loadPresetButton.addEventListener('click', handleLoadPreset);
  els.deletePresetButton.addEventListener('click', handleDeletePreset);
  els.savePresetButton.addEventListener('click', handleSavePreset);
  els.exportSetupsButton.addEventListener('click', handleExportSetups);
  els.importSetupsInput.addEventListener('change', () => handleImportSetups(els.importSetupsInput.files?.[0]));
  els.resetDataButton.addEventListener('click', handleResetData);

  return { populatePresetSelect };
}
