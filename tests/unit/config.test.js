import test from 'node:test';
import assert from 'node:assert/strict';
import { mmToPx, pxToMm, ptToMm, mmToTwips, contentWidthMm, contentHeightMm, DEFAULT_SETTINGS } from '../../src/config.js';
import { validateSettings, validatePresetSettings } from '../../src/worksheet/validateSettings.js';
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, languageName } from '../../src/languages.js';

test('mmToPx / pxToMm round-trip', () => {
  const mm = 170;
  const px = mmToPx(mm);
  assert.ok(Math.abs(px - 642.52) < 0.1);
  assert.ok(Math.abs(pxToMm(px) - mm) < 1e-9);
});

test('ptToMm matches the standard point definition', () => {
  // 72pt = 1 inch = 25.4mm
  assert.ok(Math.abs(ptToMm(72) - 25.4) < 1e-9);
});

test('mmToTwips: 25.4mm (1 inch) is 1440 twips', () => {
  assert.equal(mmToTwips(25.4), 1440);
});

test('content width/height subtract margins from A4', () => {
  assert.equal(contentWidthMm(20), 170);
  assert.equal(contentHeightMm(20), 257);
});

test('the default settings are valid, and a setup saved with them validates for every language', () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), { ok: true });
  for (const language of LANGUAGE_CODES) {
    assert.deepEqual(validatePresetSettings({ language, theme: 'stories', level: 1, ...DEFAULT_SETTINGS }), { ok: true }, language);
  }
});

test('the default settings cannot be changed by accident (the settings panel edits a copy)', () => {
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  for (const value of Object.values(DEFAULT_SETTINGS)) {
    if (value && typeof value === 'object') assert.ok(Object.isFrozen(value));
  }
});

test('the language list: unique codes, a name for each, the first is the start language', () => {
  assert.equal(new Set(LANGUAGE_CODES).size, LANGUAGE_CODES.length);
  assert.equal(DEFAULT_LANGUAGE, LANGUAGE_CODES[0]);
  for (const { code, name } of LANGUAGES) {
    assert.match(code, /^[a-z]{2,3}$/);
    assert.equal(languageName(code), name);
  }
});
