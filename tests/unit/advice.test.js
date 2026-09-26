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
  // No syllable data: no grey collision, but the teacher is told the support does nothing here.
  assert.deepEqual(advise(sheet({ ...close, syllableMode: 'colors' }, ENTRY)), ['NO_SYLLABLE_DATA']);
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

test('highlighted letter groups are compared in grey with the letter colours', () => {
  // Navy (0.051) against a b colour of nearly the same grey.
  const graphemes = [{ text: 'ma', color: '#1E3A8A' }];
  assert.deepEqual(advise(sheet({ graphemes })), []);
  assert.deepEqual(advise(sheet({ graphemes, letterColors: { b: '#1E3A8B' } })), ['GRAY_COLLISION']);
});

test('gap-fill notices: NO_GAPS while a gap-fill sheet has none, SELECTION_RESET when stale gaps were dropped', () => {
  const cloze = { ...SETTINGS, writingMode: 'cloze' };
  assert.deepEqual(advise(buildWorksheet(ENTRY, cloze, ASSETS, 'sl')), ['NO_GAPS']);
  const withGap = { key: 'sl:t@1', blanks: [0], sentence: null, showAnswers: false };
  assert.deepEqual(advise(buildWorksheet(ENTRY, cloze, ASSETS, 'sl', withGap)), []);
  const stale = { ...withGap, key: 'sl:other@1' };
  assert.deepEqual(advise(buildWorksheet(ENTRY, cloze, ASSETS, 'sl', stale)), ['SELECTION_RESET', 'NO_GAPS']);
});

test('syllable arcs: drawn only with syllable data (lightened in trace); notices for line spacing, the Word file, and stripes', async () => {
  const { ARC_COLOR } = await import('../../src/config.js');
  const { lightenColor, TRACE_LIGHTEN } = await import('../../src/text/runs.js');
  const passage = (model) => model.blocks.find((b) => b.type === 'passage');
  const arcs = { syllableArcs: true, lineHeightMultiplier: 1.4 };
  assert.equal(passage(sheet(arcs, SYLLABLE_ENTRY)).arcColor, ARC_COLOR);
  assert.equal(passage(sheet({ ...arcs, writingMode: 'trace' }, SYLLABLE_ENTRY)).arcColor, lightenColor(ARC_COLOR, TRACE_LIGHTEN));
  assert.equal(passage(sheet(arcs, ENTRY)).arcColor, null, 'no syllable data: no arcs');
  assert.equal(passage(sheet({}, SYLLABLE_ENTRY)).arcColor, null, 'off by default');
  assert.deepEqual(advise(sheet(arcs, SYLLABLE_ENTRY)), ['ARCS_NEED_LINE_SPACING', 'DOCX_OMITS_ARCS']);
  assert.deepEqual(advise(sheet({ ...arcs, lineHeightMultiplier: 1.6 }, SYLLABLE_ENTRY)), ['DOCX_OMITS_ARCS']);
  assert.deepEqual(advise(sheet(arcs, ENTRY)), ['NO_SYLLABLE_DATA'], 'arcs asked for, but the text has no syllable data');
  assert.deepEqual(advise(sheet({ lineStripes: true }, SYLLABLE_ENTRY)), ['DOCX_OMITS_STRIPES']);
});
