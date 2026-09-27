/**
 * Text-settings panel coordinator: the font select, the numeric inputs
 * (clamped to config.js limits), the reading-support toggles, tint and
 * stripes, header fields and guide height. Every handler writes one field
 * of state.settings and asks for a render. The writing-mode select sits
 * outside the panel and stays in main.js with the other primary controls.
 *
 * The plain controls are tables (NUMBER_FIELDS, SWITCHES): one row wires a
 * control to its setting for display, limits and changes alike.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * The one translated text produced here is the "Highlight letters"
 * field's inline error, through `getT`.
 */

import { SETTINGS_LIMITS, FONT_FAMILIES, DEFAULT_LETTER_COLORS } from '../config.js';
import { parseGraphemeInput } from '../text/graphemes.js';
import { ACTIVITIES } from '../worksheet/activities.js';

/** @typedef {keyof import('./elements.js').Elements} Control */

/**
 * Number boxes: [control in `els`, setting], clamped to SETTINGS_LIMITS.
 * @type {ReadonlyArray<[Control, keyof typeof SETTINGS_LIMITS]>}
 */
const NUMBER_FIELDS = [
  ['fontSizeInput', 'fontSizePt'],
  ['lineHeightInput', 'lineHeightMultiplier'],
  ['letterSpacingInput', 'letterSpacingPt'],
  ['wordSpacingInput', 'extraWordSpacePt'],
  ['guideHeightInput', 'guideHeightMm']
];

/**
 * On/off settings shown as a checkbox: [control in `els`, setting].
 * @type {ReadonlyArray<[Control, 'syllableArcs' | 'clozeWordBank' | 'sentencePerLine' | 'wordSpaceMarks' | 'printTint' | 'lineStripes' | 'printStripes' | 'lineNumbers']>}
 */
const SWITCHES = [
  ['syllableArcsToggle', 'syllableArcs'],
  ['clozeWordBankToggle', 'clozeWordBank'],
  ['sentencePerLineToggle', 'sentencePerLine'],
  ['wordSpaceMarksToggle', 'wordSpaceMarks'],
  ['printTintToggle', 'printTint'],
  ['lineStripesToggle', 'lineStripes'],
  ['printStripesToggle', 'printStripes'],
  ['lineNumbersToggle', 'lineNumbers']
];

/**
 * The sheet header's checkboxes: [control in `els`, field of settings.header].
 * @type {ReadonlyArray<[Control, 'nameLine' | 'date' | 'title' | 'instructions']>}
 */
const HEADER_SWITCHES = [
  ['headerNameLineToggle', 'nameLine'],
  ['headerDateToggle', 'date'],
  ['headerTitleToggle', 'title'],
  ['headerInstructionsToggle', 'instructions']
];

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state the single mutable app state (main.js)
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => void} ctx.requestRender
 * @param {() => (key: string, vars?: object) => string} ctx.getT a getter: main.js reassigns its translator on a language switch
 * @returns {{ populateFontSelect: () => void, applySettingsLimits: () => void, syncSettingsControlsFromState: () => void }}
 */
export function init({ state, els, requestRender, getT }) {
  /** @param {Control} key */
  const input = (key) => /** @type {HTMLInputElement} */ (els[key]);

  /** Every change: re-render the sheet on screen, if there is one. */
  function changed() {
    if (state.contentId) requestRender();
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

  /** Sets each number input's min/max from the single shared limits config (blueprint 5) — never hardcoded in HTML. */
  function applySettingsLimits() {
    for (const [key, setting] of NUMBER_FIELDS) {
      input(key).min = String(SETTINGS_LIMITS[setting].min);
      input(key).max = String(SETTINGS_LIMITS[setting].max);
    }
  }

  /** Print tint needs a tint, printed stripes need stripes. */
  function syncDependentSwitches() {
    els.printTintToggle.disabled = (state.settings.tintId ?? 'none') === 'none';
    els.printStripesToggle.disabled = !state.settings.lineStripes;
  }

  /** Reflects state.settings into the settings-panel controls — used at startup and after applying a preset. */
  function syncSettingsControlsFromState() {
    const s = state.settings;
    els.fontSelect.value = s.fontId;
    for (const [key, setting] of NUMBER_FIELDS) input(key).value = String(s[setting]);
    for (const [key, setting] of SWITCHES) input(key).checked = Boolean(s[setting]);
    // Absent in setups saved before 0.10: the instruction line is on.
    for (const [key, field] of HEADER_SWITCHES) input(key).checked = field === 'instructions' ? s.header.instructions !== false : Boolean(s.header[field]);
    els.letterColorsToggle.checked = Object.keys(s.letterColors).length > 0;
    els.graphemesInput.value = (s.graphemes ?? []).map((g) => g.text).join(', ');
    els.graphemesStatus.textContent = '';
    els.syllableColorsToggle.checked = s.syllableMode === 'colors' || s.syllableMode === 'both';
    els.syllableSeparatorsToggle.checked = s.syllableMode === 'separators' || s.syllableMode === 'both';
    els.tintSelect.value = s.tintId ?? 'none';
    els.imageSlotSelect.value = s.imageSlot ?? 'picture';
    // "Copy:" only where there are copy lines to fill.
    els.copyTargetRow.hidden = !ACTIVITIES[s.writingMode]?.copyTarget;
    els.copyTargetSelect.value = s.copyTarget ?? 'passage';
    /** @type {HTMLOptionElement} */ (els.imageSlotSelect.querySelector('option[value="none"]')).disabled = s.writingMode === 'write-own';
    syncDependentSwitches();
  }

  /**
   * The value applied is always the value shown: out-of-range input is
   * clamped, and the box is set to the clamped value.
   * @param {Control} key
   * @param {keyof typeof SETTINGS_LIMITS} setting
   */
  function updateNumber(key, setting) {
    const range = SETTINGS_LIMITS[setting];
    const value = Math.min(range.max, Math.max(range.min, Number(input(key).value)));
    state.settings[setting] = value;
    input(key).value = String(value);
    changed();
  }

  /**
   * "Highlight letters": applied only when the whole field is valid.
   * Invalid input changes nothing (the previous groups stay on the sheet)
   * and says why, next to the field (handbook §11.6 B6). Empty clears them.
   */
  function updateGraphemes() {
    const t = getT();
    const result = parseGraphemeInput(els.graphemesInput.value);
    if (!result.ok) {
      els.graphemesStatus.textContent = result.code === 'GRAPHEME_TOO_MANY'
        ? t('graphemes.tooMany', { max: result.max })
        : t('graphemes.invalid', { group: result.group });
      return;
    }
    els.graphemesStatus.textContent = '';
    state.settings.graphemes = result.groups;
    els.graphemesInput.value = result.groups.map((g) => g.text).join(', ');
    changed();
  }

  /** Colors and separators are independently toggleable (brief section 5: "and/or") — this reads both checkboxes to derive the single syllableMode value the rest of the app expects. */
  function updateSyllableMode() {
    const colors = els.syllableColorsToggle.checked;
    const separators = els.syllableSeparatorsToggle.checked;
    state.settings.syllableMode = colors && separators ? 'both' : colors ? 'colors' : separators ? 'separators' : 'off';
    changed();
  }

  els.fontSelect.addEventListener('change', () => {
    state.settings.fontId = els.fontSelect.value;
    changed();
  });
  for (const [key, setting] of NUMBER_FIELDS) input(key).addEventListener('change', () => updateNumber(key, setting));
  for (const [key, setting] of SWITCHES) {
    input(key).addEventListener('change', () => {
      state.settings[setting] = input(key).checked;
      syncDependentSwitches();
      changed();
    });
  }
  for (const [key, field] of HEADER_SWITCHES) {
    input(key).addEventListener('change', () => {
      state.settings.header[field] = input(key).checked;
      changed();
    });
  }
  els.letterColorsToggle.addEventListener('change', () => {
    state.settings.letterColors = els.letterColorsToggle.checked ? { ...DEFAULT_LETTER_COLORS } : {};
    changed();
  });
  els.graphemesInput.addEventListener('change', updateGraphemes);
  els.syllableColorsToggle.addEventListener('change', updateSyllableMode);
  els.syllableSeparatorsToggle.addEventListener('change', updateSyllableMode);
  els.tintSelect.addEventListener('change', () => {
    state.settings.tintId = els.tintSelect.value;
    syncDependentSwitches();
    changed();
  });

  return { populateFontSelect, applySettingsLimits, syncSettingsControlsFromState };
}
