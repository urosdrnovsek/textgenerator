import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphemeInput, findGraphemeSpans } from '../../src/text/graphemes.js';
import { tokenize } from '../../src/text/tokenize.js';
import { buildStyledRuns } from '../../src/text/runs.js';
import { GRAPHEME_COLORS } from '../../src/config.js';

const groups = (...texts) => texts.map((text, i) => ({ text, color: GRAPHEME_COLORS[i] }));
/** The highlighted substrings, in order. */
const found = (body, gs) => findGraphemeSpans(tokenize({ body }), gs).map((s) => body.slice(s.start, s.end));

test('the longest group wins: sch beats ch in "Schule", and ch still matches in "Buch"', () => {
  assert.deepEqual(found('Die Schule. Das Buch.', groups('ch', 'sch')), ['Sch', 'ch']);
});

test('matching is case-insensitive and finds š in šola', () => {
  assert.deepEqual(found('Šola in šola.', groups('š')), ['Š', 'š']);
});

test('a group never crosses a non-word character or joins two words', () => {
  assert.deepEqual(found('mac hine, ma-ch', groups('ch')), ['ch']);
  assert.deepEqual(found('ac h', groups('ch')), []);
});

test('no overlaps: scanning resumes after a match', () => {
  assert.deepEqual(found('aaaa', groups('aa')), ['aa', 'aa']);
});

test('parsing: trims, lowercases, NFC-normalizes, drops blanks and duplicates, and colours by position', () => {
  const decomposed = 'š'; // s + combining caron = š
  assert.deepEqual(parseGraphemeInput(` CH, sch ,, ${decomposed}, ch `), { ok: true, groups: groups('ch', 'sch', 'š') });
  assert.deepEqual(parseGraphemeInput(''), { ok: true, groups: [] });
});

test('parsing rejects anything but 1–4 letters, and more than 4 groups — naming the bad group', () => {
  assert.deepEqual(parseGraphemeInput('ch, c h'), { ok: false, code: 'GRAPHEME_INVALID', group: 'c h' });
  assert.equal(parseGraphemeInput('ch3').ok, false);
  assert.equal(parseGraphemeInput('abcde').ok, false);
  assert.equal(parseGraphemeInput('.*').ok, false);
  assert.deepEqual(parseGraphemeInput('a, b, c, d, e'), { ok: false, code: 'GRAPHEME_TOO_MANY', max: 4 });
  assert.equal(parseGraphemeInput('a, b, c, d').ok, true);
});

test('styling precedence: a letter group beats b/d colours and syllable colours, and is bold', () => {
  const runs = buildStyledRuns(
    { body: 'bdo bo', syllableBody: 'bdo bo' },
    { letterColors: { b: '#B42318', d: '#166534' }, syllableMode: 'colors', graphemes: groups('bd') }
  );
  const highlighted = runs.filter((r) => r.bold);
  assert.deepEqual(highlighted.map((r) => [r.text, r.color]), [['bd', GRAPHEME_COLORS[0]]]);
  // Outside the group, b keeps its letter colour and nothing else is bold.
  assert.ok(runs.some((r) => r.text === 'b' && r.color === '#B42318' && !r.bold));
});

test('with no groups, runs carry no bold field at all (the golden output is unchanged)', () => {
  const runs = buildStyledRuns({ body: 'Maja ima muco.', syllableBody: undefined }, { letterColors: { b: '#B42318' } });
  assert.ok(runs.every((r) => !('bold' in r)));
});
