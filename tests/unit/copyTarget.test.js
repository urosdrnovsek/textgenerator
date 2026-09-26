import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCopyRows } from '../../src/layout/copyEstimate.js';
import { markedParagraphs } from '../../src/worksheet/copyMark.js';
import { chooseSentence, emptySelection } from '../../src/worksheet/selection.js';
import { buildWorksheet } from '../../src/worksheet/build.js';
import { advise } from '../../src/worksheet/advice.js';

const ENTRY = { id: 't', version: 1, theme: 'stories', level: 1, title: 'Naslov', body: 'Maja ima muco. Muca je siva. Rada spi.', imageId: 'img', language: 'sl' };
const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'read-copy', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: {}, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
const sheet = (settings, selection) => buildWorksheet(ENTRY, { ...SETTINGS, ...settings }, ASSETS, 'sl', selection);
const passageOf = (model) => model.blocks.find((b) => b.type === 'passage');
const titleOf = (model) => model.blocks.find((b) => b.type === 'title');

test('the copy-row estimate: characters (spaces included) over characters per handwritten row', () => {
  // 170 mm / (10 mm × 0.55) = 30.9 → 30 characters a row.
  assert.equal(estimateCopyRows('x'.repeat(30), 10, 170), 1);
  assert.equal(estimateCopyRows('x'.repeat(31), 10, 170), 2);
  assert.equal(estimateCopyRows('  ', 10, 170), 0);
  assert.equal(estimateCopyRows('x'.repeat(60), 20, 170), 4, 'taller guides: fewer characters a row');
});

test('the copy target resolves on the text: whole (unmarked), first two sentences, a clicked sentence, the title', () => {
  const whole = sheet({});
  assert.equal(whole.copyTarget, 'passage');
  assert.equal(passageOf(whole).copyMark, null);
  assert.equal(whole.copyTargetText, ENTRY.body);

  const first = sheet({ copyTarget: 'first-sentences' });
  assert.deepEqual(passageOf(first).copyMark, { firstW: 0, lastW: 5 });
  assert.equal(first.copyTargetText, 'Maja ima muco. Muca je siva.');

  const none = sheet({ copyTarget: 'sentence' });
  assert.equal(passageOf(none).copyMark, null);
  assert.equal(none.copyTargetText, '');
  const one = sheet({ copyTarget: 'sentence' }, chooseSentence(emptySelection('sl:t@1'), 2));
  assert.deepEqual(passageOf(one).copyMark, { firstW: 6, lastW: 7 });
  assert.equal(one.copyTargetText, 'Rada spi.');

  const title = sheet({ copyTarget: 'title' });
  assert.equal(titleOf(title).copyMark, true);
  assert.equal(passageOf(title).copyMark, null);
  assert.equal(title.copyTargetText, 'Naslov');
});

test('outside read & copy the copy target is ignored, and there is nothing to copy', () => {
  const model = sheet({ writingMode: 'read-only', copyTarget: 'title' });
  assert.equal(model.copyTarget, 'passage');
  assert.equal(titleOf(model).copyMark, false);
  assert.equal(model.copyTargetText, '');
});

test('write about the picture has lines but nothing to copy: no copy-row estimate (bug in 0.10.0-rc.1)', () => {
  const model = sheet({ writingMode: 'write-own' });
  assert.equal(model.copyTargetText, '');
  assert.deepEqual(advise(model, { copyRows: 8, copyRowsNeeded: 0 }), []);
});

test('chooseSentence: clicking the chosen sentence again un-chooses it', () => {
  const chosen = chooseSentence(emptySelection('k'), 1);
  assert.equal(chosen.sentence, 1);
  assert.equal(chooseSentence(chosen, 1).sentence, null);
  assert.equal(chooseSentence(chosen, 2).sentence, 2);
});

test('Word marks only paragraphs the target covers whole; a part-covered one is reported', () => {
  const split = sheet({ copyTarget: 'first-sentences', sentencePerLine: true });
  assert.deepEqual(markedParagraphs(passageOf(split)), { whole: new Set([0, 1]), partial: false });
  const joined = sheet({ copyTarget: 'first-sentences' });
  assert.deepEqual(markedParagraphs(passageOf(joined)), { whole: new Set(), partial: true });
});

test('copy notices: unchosen sentence, not enough rows (from the fit facts), and the Word file missing the mark', () => {
  assert.deepEqual(advise(sheet({ copyTarget: 'sentence' })), ['COPY_TARGET_UNCHOSEN']);
  assert.deepEqual(advise(sheet({}), { copyRows: 3, copyRowsNeeded: 5 }), ['COPY_SPACE_SHORT']);
  assert.deepEqual(advise(sheet({}), { copyRows: 5, copyRowsNeeded: 5 }), []);
  assert.deepEqual(advise(sheet({ copyTarget: 'first-sentences' })), ['DOCX_OMITS_COPY_MARK']);
  assert.deepEqual(advise(sheet({ copyTarget: 'first-sentences', sentencePerLine: true })), []);
});
