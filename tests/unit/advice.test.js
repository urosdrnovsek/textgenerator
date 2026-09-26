import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advise, relativeLuminance, NOTICE_CODES } from '../../src/worksheet/advice.js';
import { buildWorksheet } from '../../src/worksheet/build.js';

const ENTRY = { id: 't', version: 1, theme: 'stories', level: 1, title: 'Naslov', body: 'Maja ima muco.', imageId: 'img', language: 'sl' };
const SYLLABLE_ENTRY = { ...ENTRY, syllable_body: 'Ma|ja i|ma mu|co.' };
const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'read-copy', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: {}, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
// The app's default letter palette (main.js DEFAULT_LETTER_COLORS), kept by the owner (handbook §11.15).
const DEFAULT_LETTERS = { b: '#B42318', d: '#166534', p: '#7C3AED', q: '#B45309' };
const sheet = (settings, entry = ENTRY) => buildWorksheet(entry, { ...SETTINGS, ...settings }, ASSETS, 'sl');

test('a plain sheet has no notices', () => {
  assert.deepEqual(advise(sheet({})), []);
});

test('advise is pure: same model, same codes, model untouched', () => {
  const model = sheet({ letterColors: DEFAULT_LETTERS });
  const before = JSON.stringify(model);
  assert.deepEqual(advise(model), advise(model));
  assert.equal(JSON.stringify(model), before);
});

test('relativeLuminance matches the handbook figures for red b and green d', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('#B42318').toFixed(3), '0.110');
  assert.equal(relativeLuminance('#166534').toFixed(3), '0.097');
});

// Detected, not shown: the UI shows it only while the grayscale preview is on (§11.15).
test('the default palette\'s b/d pair is detected as a GRAY_COLLISION', () => {
  assert.deepEqual(advise(sheet({ letterColors: DEFAULT_LETTERS })), ['GRAY_COLLISION']);
  assert.deepEqual(advise(sheet({ letterColors: { b: '#B42318', d: '#166534' } })), ['GRAY_COLLISION']);
});

test('letter colours far apart in grey, or one colour for several letters, are not a collision', () => {
  assert.deepEqual(advise(sheet({ letterColors: { b: '#000000', d: '#808080' } })), []);
  assert.deepEqual(advise(sheet({ letterColors: { b: '#B42318' } })), []);
  assert.deepEqual(advise(sheet({ letterColors: { b: '#B42318', d: '#b42318' } })), []);
});

test('syllable colours count only when they print: colours mode on and the text has syllable data', () => {
  const close = { syllableColors: ['#B42318', '#166534'] };
  assert.deepEqual(advise(sheet({ ...close, syllableMode: 'colors' }, SYLLABLE_ENTRY)), ['GRAY_COLLISION']);
  assert.deepEqual(advise(sheet({ ...close, syllableMode: 'both' }, SYLLABLE_ENTRY)), ['GRAY_COLLISION']);
  assert.deepEqual(advise(sheet({ ...close, syllableMode: 'separators' }, SYLLABLE_ENTRY)), []);
  assert.deepEqual(advise(sheet({ ...close, syllableMode: 'colors' }, ENTRY)), []);
});

test('the default syllable colours alone are not a collision', () => {
  assert.deepEqual(advise(sheet({ syllableMode: 'colors' }, SYLLABLE_ENTRY)), []);
});

// t() throws on a missing key, which turns every render into fit.internalError.
test('every notice code has a notice.<CODE> string in all five locales', () => {
  for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
    const { strings } = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'));
    for (const code of NOTICE_CODES) {
      assert.equal(typeof strings[`notice.${code}`], 'string', `${language}: notice.${code}`);
    }
  }
});
