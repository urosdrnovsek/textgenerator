/**
 * Text-settings panel coordinator: the font select, the numeric inputs
 * (clamped to config.js limits), the reading-support toggles, tint and
 * stripes, header fields and guide height. Every handler writes one field
 * of state.settings and asks for a render. Extracted verbatim from main.js
 * (0.8.1, workstream J1). The writing-mode select and the child-name field
 * sit outside the panel and stay in main.js with the other primary
 * controls.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * The one translated text produced here is the "Highlight letters"
 * field's inline error, through `getT`.
 */

import { SETTINGS_LIMITS, FONT_FAMILIES } from '../config.js';
import { parseGraphemeInput } from '../text/graphemes.js';
import { ACTIVITIES } from '../worksheet/activities.js';

/**
 * @param {object} ctx
 * @param {object} ctx.state the single mutable app state (main.js)
 * @param {Record<string, HTMLElement>} ctx.els
 * @param {Record<string, string>} ctx.defaultLetterColors restored when the letter-colours toggle is switched back on
 * @param {() => void} ctx.requestRender
 * @param {() => (key: string, vars?: object) => string} ctx.getT a getter: main.js reassigns its translator on a language switch
 * @returns {{ populateFontSelect: () => void, applySettingsLimits: () => void, syncSettingsControlsFromState: () => void }}
 */
export function init({ state, els, defaultLetterColors: DEFAULT_LETTER_COLORS, requestRender, getT }) {
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
    els.graphemesInput.value = (s.graphemes ?? []).map((g) => g.text).join(', ');
    els.graphemesStatus.textContent = '';
    els.syllableColorsToggle.checked = s.syllableMode === 'colors' || s.syllableMode === 'both';
    els.syllableSeparatorsToggle.checked = s.syllableMode === 'separators' || s.syllableMode === 'both';
    els.sentencePerLineToggle.checked = Boolean(s.sentencePerLine);
    els.wordSpaceMarksToggle.checked = Boolean(s.wordSpaceMarks);
    els.tintSelect.value = s.tintId ?? 'none';
    els.printTintToggle.checked = Boolean(s.printTint);
    els.printTintToggle.disabled = (s.tintId ?? 'none') === 'none';
    els.lineStripesToggle.checked = Boolean(s.lineStripes);
    els.printStripesToggle.checked = Boolean(s.printStripes);
    els.printStripesToggle.disabled = !s.lineStripes;
    els.lineNumbersToggle.checked = Boolean(s.lineNumbers);
    els.headerNameLineToggle.checked = Boolean(s.header.nameLine);
    els.headerDateToggle.checked = Boolean(s.header.date);
    els.headerTitleToggle.checked = Boolean(s.header.title);
    // Absent in setups saved before 0.10: on.
    els.headerInstructionsToggle.checked = s.header.instructions !== false;
    els.imageSlotSelect.value = s.imageSlot ?? 'picture';
    // "Copy:" only where there are copy lines to fill.
    els.copyTargetRow.hidden = !ACTIVITIES[s.writingMode]?.copyTarget;
    els.copyTargetSelect.value = s.copyTarget ?? 'passage';
    els.imageSlotSelect.querySelector('option[value="none"]').disabled = s.writingMode === 'write-own';
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

  /**
   * "Highlight letters": applied only when the whole field is valid.
   * Invalid input changes nothing (the previous groups stay on the sheet)
   * and says why, next to the field (handbook §11.6 B6). Empty clears them.
   */
  function updateGraphemes(input) {
    const t = getT();
    const result = parseGraphemeInput(input);
    if (!result.ok) {
      els.graphemesStatus.textContent = result.code === 'GRAPHEME_TOO_MANY'
        ? t('graphemes.tooMany', { max: result.max })
        : t('graphemes.invalid', { group: result.group });
      return;
    }
    els.graphemesStatus.textContent = '';
    state.settings.graphemes = result.groups;
    els.graphemesInput.value = result.groups.map((g) => g.text).join(', ');
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

  function updateWordSpaceMarks(enabled) {
    state.settings.wordSpaceMarks = enabled;
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

  function updateLineNumbers(enabled) {
    state.settings.lineNumbers = enabled;
    if (state.contentId) requestRender();
  }

  /** Header field toggles (upgrade blueprint v3, workstream D6) — the model and both exporters already supported these; this just exposes them in the settings panel. */
  function updateHeaderField(field, enabled) {
    state.settings.header[field] = enabled;
    if (state.contentId) requestRender();
  }

  els.fontSelect.addEventListener('change', (e) => updateFontId(e.target.value));
  els.fontSizeInput.addEventListener('change', (e) => updateNumericSetting('fontSizePt', SETTINGS_LIMITS.fontSizePt, e.target));
  els.lineHeightInput.addEventListener('change', (e) => updateNumericSetting('lineHeightMultiplier', SETTINGS_LIMITS.lineHeightMultiplier, e.target));
  els.letterSpacingInput.addEventListener('change', (e) => updateNumericSetting('letterSpacingPt', SETTINGS_LIMITS.letterSpacingPt, e.target));
  els.wordSpacingInput.addEventListener('change', (e) => updateNumericSetting('extraWordSpacePt', SETTINGS_LIMITS.extraWordSpacePt, e.target));
  els.letterColorsToggle.addEventListener('change', (e) => updateLetterColorsEnabled(e.target.checked));
  els.graphemesInput.addEventListener('change', (e) => updateGraphemes(e.target.value));
  els.syllableColorsToggle.addEventListener('change', updateSyllableMode);
  els.syllableSeparatorsToggle.addEventListener('change', updateSyllableMode);
  els.sentencePerLineToggle.addEventListener('change', (e) => updateSentencePerLine(e.target.checked));
  els.wordSpaceMarksToggle.addEventListener('change', (e) => updateWordSpaceMarks(e.target.checked));
  els.tintSelect.addEventListener('change', (e) => updateTint(e.target.value));
  els.printTintToggle.addEventListener('change', (e) => updatePrintTint(e.target.checked));
  els.lineStripesToggle.addEventListener('change', (e) => updateLineStripes(e.target.checked));
  els.printStripesToggle.addEventListener('change', (e) => updatePrintStripes(e.target.checked));
  els.lineNumbersToggle.addEventListener('change', (e) => updateLineNumbers(e.target.checked));
  els.headerNameLineToggle.addEventListener('change', (e) => updateHeaderField('nameLine', e.target.checked));
  els.headerDateToggle.addEventListener('change', (e) => updateHeaderField('date', e.target.checked));
  els.headerTitleToggle.addEventListener('change', (e) => updateHeaderField('title', e.target.checked));
  els.headerInstructionsToggle.addEventListener('change', (e) => updateHeaderField('instructions', e.target.checked));
  els.guideHeightInput.addEventListener('change', (e) => updateNumericSetting('guideHeightMm', SETTINGS_LIMITS.guideHeightMm, e.target));

  return { populateFontSelect, applySettingsLimits, syncSettingsControlsFromState };
}
