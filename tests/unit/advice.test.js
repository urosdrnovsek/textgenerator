import test from 'node:test';
import assert from 'node:assert/strict';
import { advise } from '../../src/worksheet/advice.js';
import { buildWorksheet } from '../../src/worksheet/build.js';

const ENTRY = { id: 't', version: 1, theme: 'stories', level: 1, title: 'Naslov', body: 'Maja ima muco.', imageId: 'img', language: 'sl' };
const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'read-copy', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: {}, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};

test('a plain sheet has no notices', () => {
  assert.deepEqual(advise(buildWorksheet(ENTRY, SETTINGS, ASSETS, 'sl')), []);
});

test('advise is pure: same model, same codes, model untouched', () => {
  const model = buildWorksheet(ENTRY, SETTINGS, ASSETS, 'sl');
  const before = JSON.stringify(model);
  assert.deepEqual(advise(model), advise(model));
  assert.equal(JSON.stringify(model), before);
});
