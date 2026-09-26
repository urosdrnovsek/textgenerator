import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, validatePresetSettings } from '../../src/worksheet/validateSettings.js';

const VALID_SETTINGS = {
  fontId: 'andika',
  fontSizePt: 16,
  lineHeightMultiplier: 1.4,
  letterSpacingPt: 0.3,
  extraWordSpacePt: 1,
  writingMode: 'read-copy',
  rulingId: 'standard-3line',
  guideHeightMm: 10,
  letterColors: { b: '#B42318', d: '#166534' },
  syllableMode: 'colors',
  syllableColors: ['#1D4ED8', '#B45309'],
  header: { nameLine: true, date: true, title: true },
  marginMm: 20
};

test('the real app default settings validate cleanly', () => {
  const result = validateSettings(VALID_SETTINGS);
  assert.equal(result.ok, true);
});

test('rejects an unknown fontId', () => {
  const result = validateSettings({ ...VALID_SETTINGS, fontId: 'comic-neue' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'fontId'));
});

test('accepts all four bundled fonts', () => {
  for (const fontId of ['andika', 'lexend', 'opendyslexic', 'comicneue']) {
    assert.equal(validateSettings({ ...VALID_SETTINGS, fontId }).ok, true, `${fontId} should be a valid fontId`);
  }
});

test('rejects a font size outside the configured range', () => {
  const tooSmall = validateSettings({ ...VALID_SETTINGS, fontSizePt: 4 });
  const tooBig = validateSettings({ ...VALID_SETTINGS, fontSizePt: 100 });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooBig.ok, false);
});

test('rejects a non-numeric spacing value instead of coercing it', () => {
  const result = validateSettings({ ...VALID_SETTINGS, letterSpacingPt: '0.3' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'letterSpacingPt'));
});

test('rejects an unknown writingMode', () => {
  const result = validateSettings({ ...VALID_SETTINGS, writingMode: 'cursive' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'writingMode'));
});

test('rejects an unknown rulingId', () => {
  const result = validateSettings({ ...VALID_SETTINGS, rulingId: 'french-seyes' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'rulingId'));
});

test('rejects a malformed letter color', () => {
  const result = validateSettings({ ...VALID_SETTINGS, letterColors: { b: 'red' } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'letterColors.b'));
});

test('rejects a malformed syllable color', () => {
  const result = validateSettings({ ...VALID_SETTINGS, syllableColors: ['#1D4ED8', 'blue'] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'syllableColors[1]'));
});

test('rejects a missing/incomplete header object', () => {
  const result = validateSettings({ ...VALID_SETTINGS, header: { nameLine: true } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'header'));
});

test('collects multiple errors in one pass rather than stopping at the first', () => {
  const result = validateSettings({ ...VALID_SETTINGS, fontId: 'nope', writingMode: 'nope', fontSizePt: -5 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3);
});

test('accepts settings with lineStripes and printStripes set', () => {
  const result = validateSettings({ ...VALID_SETTINGS, lineStripes: true, printStripes: false });
  assert.equal(result.ok, true);
});

test('rejects a non-boolean lineStripes or printStripes', () => {
  assert.equal(validateSettings({ ...VALID_SETTINGS, lineStripes: 'yes' }).ok, false);
  assert.equal(validateSettings({ ...VALID_SETTINGS, printStripes: 'yes' }).ok, false);
});

test('accepts settings with sentencePerLine, tintId, and printTint set', () => {
  const result = validateSettings({ ...VALID_SETTINGS, sentencePerLine: true, tintId: 'cream', printTint: false });
  assert.equal(result.ok, true);
});

test('accepts "separators" and "both" syllable modes', () => {
  assert.equal(validateSettings({ ...VALID_SETTINGS, syllableMode: 'separators' }).ok, true);
  assert.equal(validateSettings({ ...VALID_SETTINGS, syllableMode: 'both' }).ok, true);
});

test('accepts writingMode "trace"', () => {
  assert.equal(validateSettings({ ...VALID_SETTINGS, writingMode: 'trace' }).ok, true);
});

test('rejects a non-boolean sentencePerLine', () => {
  const result = validateSettings({ ...VALID_SETTINGS, sentencePerLine: 'yes' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'sentencePerLine'));
});

test('rejects an unknown tintId', () => {
  const result = validateSettings({ ...VALID_SETTINGS, tintId: 'lavender' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'tintId'));
});

test('rejects a non-boolean printTint', () => {
  const result = validateSettings({ ...VALID_SETTINGS, printTint: 'yes' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'printTint'));
});

test('sentencePerLine, tintId, and printTint are all optional — their absence is not an error', () => {
  assert.equal(validateSettings(VALID_SETTINGS).ok, true);
});

const VALID_PRESET_SETTINGS = { ...VALID_SETTINGS, language: 'sl', theme: 'stories', level: 1 };

test('validatePresetSettings accepts a valid preset (language/theme/level plus WorksheetSettings)', () => {
  assert.equal(validatePresetSettings(VALID_PRESET_SETTINGS).ok, true);
});

test('validatePresetSettings rejects an unknown language', () => {
  const result = validatePresetSettings({ ...VALID_PRESET_SETTINGS, language: 'xx' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'language'));
});

test('validatePresetSettings rejects an unknown theme', () => {
  const result = validatePresetSettings({ ...VALID_PRESET_SETTINGS, theme: 'space_pirates' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'theme'));
});

test('validatePresetSettings rejects an out-of-range level', () => {
  const result = validatePresetSettings({ ...VALID_PRESET_SETTINGS, level: 9 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'level'));
});

test('validatePresetSettings also surfaces underlying WorksheetSettings errors (e.g. an unknown rulingId)', () => {
  const result = validatePresetSettings({ ...VALID_PRESET_SETTINGS, rulingId: 'does-not-exist' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'rulingId'));
});

test('validatePresetSettings rejects a non-object', () => {
  assert.equal(validatePresetSettings(null).ok, false);
  assert.equal(validatePresetSettings(undefined).ok, false);
});

test('accepts lineNumbers on, off or absent, and rejects a non-boolean', () => {
  assert.equal(validateSettings({ ...VALID_SETTINGS, lineNumbers: true }).ok, true);
  assert.equal(validateSettings({ ...VALID_SETTINGS, lineNumbers: false }).ok, true);
  assert.equal(validateSettings(VALID_SETTINGS).ok, true);
  assert.equal(validateSettings({ ...VALID_SETTINGS, lineNumbers: 'yes' }).ok, false);
});
