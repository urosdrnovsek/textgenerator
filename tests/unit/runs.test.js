import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterRuns, buildSyllableRuns, buildStyledRuns, countWords } from '../../src/text/runs.js';

test('colors b/d while preserving the exact passage, including Slovene diacritics', () => {
  const source = 'b d p q č š ž <b>';
  const runs = buildLetterRuns(source, {
    letterColors: { b: '#B42318', d: '#166534' }
  });
  assert.equal(runs.map((run) => run.text).join(''), source);
  assert.ok(runs.some((run) => run.text === 'b' && run.color === '#B42318'));
  assert.ok(runs.some((run) => run.text === 'd' && run.color === '#166534'));
  assert.ok(runs.some((run) => run.text.includes('č š ž')));
});

test('uppercase letters are not colored unless uppercaseAlso is set', () => {
  const runs = buildLetterRuns('Bob', { letterColors: { b: '#B42318' } });
  assert.equal(runs.map((r) => r.text).join(''), 'Bob');
  const withUpper = buildLetterRuns('Bob', { letterColors: { b: '#B42318' }, uppercaseAlso: true });
  assert.ok(withUpper[0].color === '#B42318');
});

test('rejects invalid hex colors', () => {
  assert.throws(() => buildLetterRuns('b', { letterColors: { b: 'red' } }));
});

test('syllable runs alternate per syllable and reset at each word', () => {
  const syllableBody = 'Ma|ja i|ma';
  const runs = buildSyllableRuns(syllableBody, { syllableColors: ['#111111', '#222222'] });
  assert.equal(runs.map((r) => r.text).join(''), syllableBody.replaceAll('|', ''));
  // "Ma"(0) "ja"(1) " "(base) "i"(0, reset at word boundary) "ma"(1)
  assert.deepEqual(
    runs.map((r) => [r.text, r.color]),
    [
      ['Ma', '#111111'],
      ['ja', '#222222'],
      [' ', '#202020'],
      ['i', '#111111'],
      ['ma', '#222222']
    ]
  );
});

test('confused-letter colors override syllable colors on the same glyph', () => {
  const syllableBody = 'ma|ba';
  const runs = buildSyllableRuns(syllableBody, {
    syllableColors: ['#111111', '#222222'],
    letterColors: { b: '#B42318' }
  });
  const bRun = runs.find((r) => r.text.includes('b'));
  assert.equal(bRun.color, '#B42318');
});

test('buildStyledRuns picks syllable mode only when both requested and available', () => {
  const withSyllables = buildStyledRuns(
    { body: 'Maja ima', syllableBody: 'Ma|ja i|ma' },
    { syllableMode: 'colors', syllableColors: ['#111111', '#222222'] }
  );
  assert.ok(withSyllables.some((r) => r.color === '#222222'));

  const withoutMarkers = buildStyledRuns(
    { body: 'Maja ima', syllableBody: undefined },
    { syllableMode: 'colors', syllableColors: ['#111111', '#222222'] }
  );
  assert.equal(withoutMarkers.map((r) => r.text).join(''), 'Maja ima');
});

test('countWords counts whole words, not syllable/letter run fragments', () => {
  assert.equal(countWords('Maja ima modrega zmaja.', 'sl'), 4);
  assert.equal(countWords('', 'sl'), 0);
});

test('removing presentation styles never changes the underlying text (property check)', () => {
  const samples = [
    'b d p q č š ž',
    'Zmaj je poskočil čez živo mejo.',
    'Édouard über naïve café'
  ];
  for (const text of samples) {
    const runs = buildLetterRuns(text, { letterColors: { b: '#B42318', d: '#166534' } });
    assert.equal(runs.map((r) => r.text).join(''), text);
  }
});
