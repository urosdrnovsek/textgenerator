/**
 * "Saved setups": the two built-in setups, the teacher's own (save, load,
 * delete), their backup file (export, import), and "Reset saved data".
 * Storage is storage.js; validation is worksheet/validateSettings.js.
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
 * formatting only, leave these as they are.
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
   * The built-in setups are formatting only: no language, theme, level or
   * text. A setup the teacher saved carries those, and restores them.
   * "Standard" is the defaults a new sheet starts with.
   */
  const STANDARD_FORMATTING = DEFAULT_SETTINGS;

  /** A starting point, not a treatment: larger type, 1.6 line spacing, a little more space between letters and words. */
  const DYSLEXIA_FORMATTING = {
    ...STANDARD_FORMATTING,
    fontSizePt: 18,
    lineHeightMultiplier: 1.6,
    letterSpacingPt: 0.5,
    extraWordSpacePt: 1.5
  };

  /**
   * The built-in setups exist whether or not the browser stores anything. A
   * function, so their names follow the interface language.
   */
  function getBuiltInPresets() {
    return [
      { id: 'builtin-standard', name: t('preset.builtin.standard'), builtin: true, settings: STANDARD_FORMATTING },
      { id: 'builtin-dyslexia', name: t('preset.builtin.dyslexia'), builtin: true, settings: DYSLEXIA_FORMATTING }
    ];
  }

  /** The "Dyslexia-friendly" button loads the built-in setup of that name: one code path. */
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
   * Applies a setup after validating it: a stored or imported one may be
   * hand-edited, from another version, or damaged, and is refused with a
   * message rather than failing later in the layout.
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
    // Copies: the settings panel changes nested objects (header, letter
    // colours) in place, which would otherwise rewrite the setup itself. A
    // setting missing from an older setup takes its default.
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
