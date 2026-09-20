import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildLetterRuns, buildSyllableRuns, buildStyledRuns, splitRunsIntoSentences, countWords } from '../../src/text/runs.js';
import { splitIntoSentences } from '../../src/text/prepare.js';

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

test('a name substituted as a single unsplit chunk (as resolvePersonalization does for a teacher-typed name) still alternates correctly around it', () => {
  // "Zgod"(0) "ba"(1) " "(base) "o"(0, word boundary reset) " "(base) "Eva."(0, its own word — one chunk, not split into syllables)
  const syllableBody = 'Zgod|ba o Eva.';
  const runs = buildSyllableRuns(syllableBody, { syllableColors: ['#111111', '#222222'] });
  assert.equal(runs.map((r) => r.text).join(''), syllableBody.replaceAll('|', ''));
  assert.deepEqual(
    runs.map((r) => [r.text, r.color]),
    [
      ['Zgod', '#111111'],
      ['ba', '#222222'],
      [' ', '#202020'],
      ['o', '#111111'],
      [' ', '#202020'],
      ['Eva.', '#111111']
    ]
  );
});

test('separators mode inserts a middle dot between syllables, syllable text staying base-colored', () => {
  const syllableBody = 'Ma|ja i|ma';
  const runs = buildSyllableRuns(syllableBody, { syllableMode: 'separators' });
  assert.equal(runs.map((r) => r.text).join(''), 'Ma·ja i·ma');
  // no syllable-alternation color should appear on the letters themselves
  const letterRuns = runs.filter((r) => r.text !== '·');
  assert.ok(letterRuns.every((r) => r.color === '#202020'));
  // the separator marks do get their own (default) color
  const separatorRuns = runs.filter((r) => r.text === '·');
  assert.ok(separatorRuns.every((r) => r.color === '#64748B'));
});

test('both mode combines separators and alternating colors', () => {
  const syllableBody = 'Ma|ja';
  const runs = buildSyllableRuns(syllableBody, { syllableMode: 'both', syllableColors: ['#111111', '#222222'] });
  assert.equal(runs.map((r) => r.text).join(''), 'Ma·ja');
  assert.deepEqual(runs.map((r) => [r.text, r.color]), [
    ['Ma', '#111111'],
    ['·', '#64748B'],
    ['ja', '#222222']
  ]);
});

test('separators respect confused-letter color precedence, same as colors mode', () => {
  const runs = buildSyllableRuns('ba|be', { syllableMode: 'separators', letterColors: { b: '#B42318' } });
  const bRuns = runs.filter((r) => r.text.includes('b'));
  assert.ok(bRuns.every((r) => r.color === '#B42318'));
});

test('buildStyledRuns treats "separators" and "both" as syllable modes too, not just "colors"', () => {
  const result = buildStyledRuns(
    { body: 'Maja ima', syllableBody: 'Ma|ja i|ma' },
    { syllableMode: 'separators' }
  );
  assert.equal(result.map((r) => r.text).join(''), 'Ma·ja i·ma');
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

test('splitRunsIntoSentences cuts a flat run array into one array per sentence, preserving colors', () => {
  const text = 'Maja ima muco. Muca spi.';
  const runs = buildLetterRuns(text, { letterColors: { m: '#B42318' } });
  const sentences = splitIntoSentences(text);
  const paragraphs = splitRunsIntoSentences(runs, sentences);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs.map((p) => p.map((r) => r.text).join('')).join('|'), 'Maja ima muco.|Muca spi.');
  // color survives the split — each paragraph still has a colored "m" run
  assert.ok(paragraphs[0].some((r) => r.color === '#B42318'), 'first paragraph ("ima", "muco") should retain the letter color');
  assert.ok(paragraphs[1].every((r) => r.color === '#202020'), 'second paragraph ("Muca spi.") has no lowercase m, so stays base color');
});

test('splitRunsIntoSentences splits correctly even when a sentence boundary falls inside a merged run', () => {
  // No letterColors at all -> the whole text is one single merged run.
  const text = 'Ena. Dve. Tri.';
  const runs = buildLetterRuns(text, {});
  assert.equal(runs.length, 1, 'sanity check: the whole text merged into one run');
  const paragraphs = splitRunsIntoSentences(runs, splitIntoSentences(text));
  assert.deepEqual(paragraphs.map((p) => p.map((r) => r.text).join('')), ['Ena.', 'Dve.', 'Tri.']);
});

test('splitRunsIntoSentences: reconstructed text from paragraphs matches splitIntoSentences for every real content entry (property check)', async () => {
  const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const pack = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  for (const entry of pack.entries) {
    const runs = buildLetterRuns(entry.body, { letterColors: { b: '#B42318', d: '#166534' } });
    const sentences = splitIntoSentences(entry.body);
    const paragraphs = splitRunsIntoSentences(runs, sentences);
    assert.equal(paragraphs.length, sentences.length, `${entry.id}: one paragraph per sentence`);
    const reconstructed = paragraphs.map((p) => p.map((r) => r.text).join(''));
    assert.deepEqual(reconstructed, sentences, `${entry.id}: paragraph text must match the sentence it was cut for`);
  }
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
