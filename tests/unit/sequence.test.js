import test from 'node:test';
import assert from 'node:assert/strict';
import { hashString, mulberry32, seededDerangement, sequenceLength } from '../../src/worksheet/sequence.js';
import { buildWorksheet } from '../../src/worksheet/build.js';

test('hashString is FNV-1a 32-bit (published test vectors)', () => {
  assert.equal(hashString(''), 0x811c9dc5);
  assert.equal(hashString('a'), 0xe40c292c);
});

// The compatibility promise: a sequencing sheet a teacher kept is re-made
// in the same order next year. If this fails, the hash or PRNG changed —
// put it back; don't update the snapshot.
test('the order is pinned for two real texts', () => {
  assert.deepEqual(seededDerangement(6, 'stories_muc_1'), [4, 0, 3, 2, 5, 1]);
  assert.deepEqual(seededDerangement(6, 'stories_kite_in_tree_1'), [1, 0, 4, 5, 3, 2]);
});

test('always a derangement: a permutation where no sentence keeps its place (n = 3…6, 500 seeds each)', () => {
  for (let n = 3; n <= 6; n++) {
    for (let seed = 0; seed < 500; seed++) {
      const order = seededDerangement(n, `entry_${seed}`);
      assert.deepEqual([...order].sort(), [...Array(n).keys()], `n=${n} seed=${seed}: a permutation`);
      assert.ok(order.every((original, position) => original !== position), `n=${n} seed=${seed}: no fixed point`);
    }
  }
});

test('deterministic: the same seed gives the same order and the same random stream', () => {
  assert.deepEqual(seededDerangement(5, 'x'), seededDerangement(5, 'x'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('which sentences: all of 3–6, the first 6 of more, none below 3', () => {
  assert.equal(sequenceLength(2), 0);
  assert.equal(sequenceLength(3), 3);
  assert.equal(sequenceLength(6), 6);
  assert.equal(sequenceLength(18), 6);
});

const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'sequence', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: { b: '#B42318' }, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
const entry = (body) => ({ id: 'stories_muc_1', version: 1, theme: 'stories', level: 1, title: 'Naslov', body, imageId: 'img', language: 'sl' });
const text = (runs) => runs.map((r) => r.text).join('');

test('the sheet: title, instruction, picture, then the shuffled sentences, each styled, with its place in the text', () => {
  const body = 'Ena. Dva bo. Tri. Štiri. Pet. Šest. Sedem.';
  const model = buildWorksheet(entry(body), SETTINGS, ASSETS, 'sl');
  assert.deepEqual(model.blocks.map((b) => b.type), ['header', 'title', 'instruction', 'image', 'sequence']);
  const block = model.blocks.at(-1);
  assert.equal(block.sentenceCount, 7);
  assert.deepEqual(block.items.map((i) => i.position), [5, 1, 4, 3, 6, 2], 'the pinned order, 1-based');
  assert.deepEqual(block.items.map((i) => text(i.runs)), ['Pet.', 'Ena.', 'Štiri.', 'Tri.', 'Šest.', 'Dva bo.'], 'the seventh sentence is not used');
  assert.ok(block.items.find((i) => i.position === 2).runs.some((r) => r.text === 'b' && r.color === '#B42318'), 'reading supports apply');
  assert.equal(block.showAnswers, false);
  assert.ok(!model.blocks.some((b) => b.type === 'passage'), 'the passage itself is hidden');
});

test('the answer key numbers the boxes; a text with too few sentences has no items (the fit check blocks it)', () => {
  const key = buildWorksheet(entry('Ena. Dva. Tri.'), SETTINGS, ASSETS, 'sl', { key: 'sl:stories_muc_1@1', blanks: [], sentence: null, showAnswers: true });
  assert.equal(key.blocks[0].type, 'answerTag');
  assert.equal(key.blocks.at(-1).showAnswers, true);
  const short = buildWorksheet(entry('Ena. Dva.'), SETTINGS, ASSETS, 'sl', { key: 'sl:stories_muc_1@1', blanks: [], sentence: null, showAnswers: true });
  assert.deepEqual(short.blocks.at(-1).items, []);
  assert.equal(short.blocks.at(-1).sentenceCount, 2);
  assert.ok(!short.blocks.some((b) => b.type === 'answerTag'), 'nothing to answer: not a key');
});
