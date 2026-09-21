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

test('buildWorksheet returns settings that do not alias the caller\'s object (a model is a snapshot)', () => {
  // main.js mutates its live settings object in place on every control
  // change; a model stored in a packet must not follow those changes. Every
  // field is mutated here on purpose — a partial-copy regression would
  // pass a one-field test.
  const live = structuredClone(BASE_SETTINGS);
  live.sentencePerLine = false;
  live.tintId = 'none';
  live.printTint = false;
  live.lineStripes = false;
  live.printStripes = false;
  const model = buildWorksheet(ENTRY, live, ASSETS, 'sl');
  const reference = structuredClone(model.settings);

  live.fontId = 'lexend';
  live.fontSizePt = 32;
  live.lineHeightMultiplier = 2.5;
  live.letterSpacingPt = 4;
  live.extraWordSpacePt = 6;
  live.writingMode = 'read-only';
  live.rulingId = 'other';
  live.guideHeightMm = 20;
  live.marginMm = 10;
  live.syllableMode = 'off';
  live.sentencePerLine = true;
  live.tintId = 'cream';
  live.printTint = true;
  live.lineStripes = true;
  live.printStripes = true;
  live.header.nameLine = false;
  live.header.date = false;
  live.header.title = false;
  live.letterColors.b = '#000000'; // in-place mutation of a nested map
  live.letterColors = { z: '#111111' }; // and reassignment
  live.syllableColors.push('#222222'); // in-place mutation of a nested array

  assert.deepEqual(model.settings, reference);
  assert.notDeepEqual(model.settings, live);
});
