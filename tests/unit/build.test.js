import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorksheet } from '../../src/worksheet/build.js';

const ENTRY = {
  id: 'test_entry',
  version: 1,
  theme: 'stories',
  level: 1,
  title: 'Naslov',
  body: 'Maja ima muco. Muca spi.',
  syllable_body: 'Ma|ja i|ma mu|co. Mu|ca spi.',
  imageId: 'test_image',
  language: 'sl'
};

const ASSETS = { imagesById: new Map([['test_image', { id: 'test_image', path: 'data:image/jpeg;base64,x' }]]) };

const BASE_SETTINGS = {
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
  personalization: { name: '' },
  marginMm: 20
};

test('bodyParagraphs has a single element when sentencePerLine is off', () => {
  const model = buildWorksheet(ENTRY, BASE_SETTINGS, ASSETS, 'sl');
  assert.equal(model.bodyParagraphs.length, 1);
  const fullText = model.bodyParagraphs[0].map((r) => r.text).join('');
  assert.equal(fullText, ENTRY.body);
});

test('bodyParagraphs has one entry per sentence when sentencePerLine is on', () => {
  const model = buildWorksheet(ENTRY, { ...BASE_SETTINGS, sentencePerLine: true }, ASSETS, 'sl');
  assert.equal(model.bodyParagraphs.length, 2);
  assert.equal(model.bodyParagraphs.map((p) => p.map((r) => r.text).join('')).join('|'), 'Maja ima muco.|Muca spi.');
});

test('trace mode lightens every run color while keeping distinct colors distinct', () => {
  const normal = buildWorksheet(ENTRY, BASE_SETTINGS, ASSETS, 'sl');
  const traced = buildWorksheet(ENTRY, { ...BASE_SETTINGS, writingMode: 'trace' }, ASSETS, 'sl');

  const normalColors = normal.bodyParagraphs[0].map((r) => r.color);
  const tracedColors = traced.bodyParagraphs[0].map((r) => r.color);

  assert.equal(normalColors.length, tracedColors.length);
  assert.notDeepEqual(normalColors, tracedColors, 'trace colors must differ from normal colors');
  // still as many distinct colors as before — distinction preserved (blueprint 8.6)
  assert.equal(new Set(normalColors).size, new Set(tracedColors).size);
  // text itself is untouched by trace mode
  assert.equal(
    traced.bodyParagraphs[0].map((r) => r.text).join(''),
    normal.bodyParagraphs[0].map((r) => r.text).join('')
  );
});

test('trace mode does not affect read-copy/read-only rendering colors', () => {
  const readOnly = buildWorksheet(ENTRY, { ...BASE_SETTINGS, writingMode: 'read-only' }, ASSETS, 'sl');
  const readCopy = buildWorksheet(ENTRY, { ...BASE_SETTINGS, writingMode: 'read-copy' }, ASSETS, 'sl');
  assert.deepEqual(
    readOnly.bodyParagraphs[0].map((r) => r.color),
    readCopy.bodyParagraphs[0].map((r) => r.color)
  );
});

test('throws a clear error when the entry references an unknown imageId', () => {
  const badEntry = { ...ENTRY, imageId: 'does-not-exist' };
  assert.throws(() => buildWorksheet(badEntry, BASE_SETTINGS, ASSETS, 'sl'), /MISSING_IMAGE/);
});
