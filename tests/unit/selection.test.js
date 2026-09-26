import test from 'node:test';
import assert from 'node:assert/strict';
import { keyFor, emptySelection, toggleBlank, blankEveryNth, clearBlanks, selectionFor, blankWidthEm, maxBlanks } from '../../src/worksheet/selection.js';
import { tokenize } from '../../src/text/tokenize.js';
import { buildStyledRuns } from '../../src/text/runs.js';

// 3 sentences, 14 words: "Maja ima muco." (0–2) "Muca je majhna in siva." (3–7) "Rada spi na soncu, ko sije." (8–13)
const BODY = 'Maja ima muco. Muca je majhna in siva. Rada spi na soncu, ko sije.';
const doc = tokenize({ body: BODY });
const KEY = 'sl:t@1';
const words = (sel) => sel.blanks.map((w) => doc.words[w].text);

test('keyFor names the text and its version', () => {
  assert.equal(keyFor({ language: 'en', id: 'stories_kite_3', version: 2 }), 'en:stories_kite_3@2');
});

test('toggleBlank turns a word into a gap and back, keeping blanks sorted and distinct, without touching its input', () => {
  const empty = emptySelection(KEY);
  const one = toggleBlank(empty, 5, doc).selection;
  const two = toggleBlank(one, 1, doc).selection;
  assert.deepEqual(two.blanks, [1, 5]);
  assert.deepEqual(toggleBlank(two, 5, doc).selection.blanks, [1]);
  assert.deepEqual(empty.blanks, [], 'input unchanged');
  assert.deepEqual(toggleBlank(two, 99, doc).selection.blanks, [1, 5], 'out of range: nothing happens');
});

test('at most 40% of the words may be gaps; one more is refused and changes nothing', () => {
  assert.equal(maxBlanks(doc), 5);
  let sel = emptySelection(KEY);
  for (const w of [0, 2, 4, 6, 8]) sel = toggleBlank(sel, w, doc).selection;
  assert.deepEqual(toggleBlank(sel, 10, doc), { ok: false, code: 'TOO_MANY_GAPS', max: 5 });
  assert.equal(toggleBlank(sel, 8, doc).ok, true, 'removing a gap at the cap still works');
});

test('every Nth word: the first sentence stays whole, counting starts with the second, and it replaces the current gaps', () => {
  const sel = blankEveryNth(toggleBlank(emptySelection(KEY), 0, doc).selection, doc, 3);
  assert.deepEqual(words(sel), ['majhna', 'Rada', 'soncu']);
  assert.ok(sel.blanks.every((w) => doc.words[w].sentence > 0));
  assert.deepEqual(blankEveryNth(emptySelection(KEY), doc, 1).blanks, blankEveryNth(emptySelection(KEY), doc, 3).blanks, 'N is clamped to 3–10');
  assert.deepEqual(clearBlanks(sel).blanks, []);
});

test('selectionFor: a selection for another text or version is dropped and reported; stale indices are dropped', () => {
  const sel = { key: KEY, blanks: [1, 1, 40, -2, 3], sentence: 9, showAnswers: true };
  assert.deepEqual(selectionFor(sel, KEY, doc), { selection: { key: KEY, blanks: [1, 3], sentence: null, showAnswers: true }, reset: false });
  assert.deepEqual(selectionFor(sel, 'sl:t@2', doc), { selection: emptySelection('sl:t@2'), reset: true });
  assert.deepEqual(selectionFor(emptySelection(KEY), 'sl:t@2', doc).reset, false, 'nothing chosen: nothing to report');
  assert.deepEqual(selectionFor(undefined, KEY, doc), { selection: emptySelection(KEY), reset: false });
});

test('one gap width per sheet, sized for the longest answer, never under 4em', () => {
  assert.equal(blankWidthEm(doc, [1]), 4, '"ima" is short: the minimum');
  assert.ok(Math.abs(blankWidthEm(doc, [1, 5]) - 0.55 * 6 * 1.6) < 1e-9, '"majhna" (6 letters) sets it');
});

test('a gap is one run for the whole word in the base colour; punctuation and syllable breaks around it behave', () => {
  const runs = buildStyledRuns(
    { body: 'Rada spi na soncu, ko sije.', syllableBody: 'Ra|da spi na son|cu, ko si|je.' },
    { syllableMode: 'both', letterColors: { d: '#166534' }, blanks: [0, 3] }
  );
  const gaps = runs.filter((r) => r.blank);
  assert.deepEqual(gaps.map((r) => [r.text, r.w, r.color]), [['Rada', 0, '#202020'], ['soncu', 3, '#202020']]);
  const shown = runs.map((r) => (r.blank ? '[gap]' : r.text)).join('');
  assert.equal(shown, '[gap] spi na [gap], ko si·je.', 'no separator inside a gap, the comma stays, later syllables still marked');
});
