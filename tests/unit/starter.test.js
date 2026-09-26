import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorksheet } from '../../src/worksheet/build.js';
import { advise } from '../../src/worksheet/advice.js';

const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'starter', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: { b: '#B42318' }, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
const sheet = (body, settings = {}) =>
  buildWorksheet({ id: 't', version: 1, theme: 'stories', level: 1, title: 'Naslov', body, imageId: 'img', language: 'sl' }, { ...SETTINGS, ...settings }, ASSETS, 'sl');
const passageTexts = (model) => model.blocks.find((b) => b.type === 'passage').paragraphs.map((runs) => runs.map((r) => r.text).join(''));

test('the sheet: title, instruction, picture, the beginning of the text, then lines to write on', () => {
  const model = sheet('Maja ima muco. Muca je bela. Rada spi. Zvečer se zbudi.');
  assert.deepEqual(model.blocks.map((b) => b.type), ['header', 'title', 'instruction', 'image', 'passage']);
  assert.equal(model.blocks[2].key, 'starter');
  assert.equal(model.task, 'lines');
  assert.deepEqual(passageTexts(model), ['Maja ima muco. Muca je bela.']);
});

test('always at least one sentence left to continue from; a one-sentence text keeps its sentence', () => {
  assert.deepEqual(passageTexts(sheet('Ena. Dva.')), ['Ena.']);
  assert.deepEqual(passageTexts(sheet('Ena. Dva. Tri.')), ['Ena. Dva.']);
  assert.deepEqual(passageTexts(sheet('Samo ena poved.')), ['Samo ena poved.']);
});

test('one paragraph per sentence with sentence-per-line; a paragraph break inside the beginning is kept as text', () => {
  assert.deepEqual(passageTexts(sheet('Ena. Dva. Tri.', { sentencePerLine: true })), ['Ena.', 'Dva.']);
  assert.deepEqual(passageTexts(sheet('Ena.\n\nDva. Tri.')), ['Ena.\n\nDva.']);
});

test('reading supports apply to the beginning; nothing is copied, so no copy-row estimate', () => {
  const model = sheet('Bobi ima kost. Muca je bela. Rada spi.');
  // "Bobi": the lowercase b is coloured (capitals aren't, by default).
  assert.ok(model.blocks.find((b) => b.type === 'passage').paragraphs[0].some((r) => r.text === 'b' && r.color === '#B42318'));
  assert.equal(model.copyTargetText, '');
  assert.deepEqual(advise(model, { copyRows: 6, copyRowsNeeded: 0 }), []);
});
