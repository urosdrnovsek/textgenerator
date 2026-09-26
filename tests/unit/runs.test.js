import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildStyledRuns, splitRunsIntoSentences, countWords } from '../../src/text/runs.js';

// The pre-0.10 builders (plain letters / syllables) became one styleText
// function; these helpers keep the tests' original vocabulary.
const buildLetterRuns = (text, options = {}) => buildStyledRuns({ body: text, syllableBody: undefined }, { ...options, syllableMode: 'off' });
const buildSyllableRuns = (syllableBody, options = {}) =>
  buildStyledRuns({ body: syllableBody.replaceAll('|', ''), syllableBody }, { syllableMode: 'colors', ...options });
/** What a reader sees: adjacent same-colour runs merged, metadata dropped — runs now also split at word/syllable boundaries. */
const byColor = (runs) => {
  const merged = [];
  for (const { text, color } of runs) {
    if (merged.length > 0 && merged.at(-1)[1] === color) merged.at(-1)[0] += text;
    else merged.push([text, color]);
  }
  return merged;
};
import { splitIntoSentences } from '../../src/text/prepare.js';

test('colors b/d while preserving the exact passage, including Slovene diacritics', () => {
  const source = 'b d p q č š ž <b>';
  const runs = buildLetterRuns(source, {
    letterColors: { b: '#B42318', d: '#166534' }
  });
  assert.equal(runs.map((run) => run.text).join(''), source);
  assert.ok(runs.some((run) => run.text === 'b' && run.color === '#B42318'));
  assert.ok(runs.some((run) => run.text === 'd' && run.color === '#166534'));
  assert.ok(byColor(runs).some(([text]) => text.includes('č š ž')));
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
    byColor(runs),
    [
      ['Ma', '#111111'],
      ['ja', '#222222'],
      [' ', '#202020'],
      ['i', '#111111'],
      ['ma', '#222222']
    ]
  );
});

test('a word with no syllable marks of its own (a one-syllable name) still alternates correctly around it', () => {
  // "Zgod"(0) "ba"(1) " "(base) "o"(0, word boundary reset) " "(base) "Eva."(0, its own word — one chunk, not split into syllables)
  const syllableBody = 'Zgod|ba o Eva.';
  const runs = buildSyllableRuns(syllableBody, { syllableColors: ['#111111', '#222222'] });
  assert.equal(runs.map((r) => r.text).join(''), syllableBody.replaceAll('|', ''));
  assert.deepEqual(
    byColor(runs),
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
  assert.deepEqual(byColor(runs), [
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
  // One single run holding the whole text, so every boundary falls inside it.
  const text = 'Ena. Dve. Tri.';
  const runs = [{ text, color: '#202020' }];
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

test('splitRunsIntoSentences does not count inserted syllable separators as source text', async () => {
  const { splitIntoSentences } = await import('../../src/text/prepare.js');
  const body = 'Maja ima muco. Muca spi.';
  const runs = buildSyllableRuns('Ma|ja i|ma mu|co. Mu|ca spi.', { syllableMode: 'both' });
  const texts = splitRunsIntoSentences(runs, splitIntoSentences(body)).map((p) => p.map((r) => r.text).join(''));
  // Before 0.10 this was ["Ma·ja i·ma mu·", "co. Mu·ca"] — cut short, and "spi." lost.
  assert.deepEqual(texts, ['Ma·ja i·ma mu·co.', 'Mu·ca spi.']);
});

test('word-space marks: one faint "_" before each space between two words of a sentence, none between sentences', async () => {
  const { WORD_SPACE_MARK_COLOR } = await import('../../src/config.js');
  const runs = buildStyledRuns({ body: 'Maja, ima muco. Mia spi.', syllableBody: undefined }, { wordSpaceMarks: true });
  const shown = runs.map((r) => (r.kind === 'mark' ? '[_]' : r.text)).join('');
  assert.equal(shown, 'Maja,[_] ima[_] muco. Mia[_] spi.');
  const marks = runs.filter((r) => r.kind === 'mark');
  assert.ok(marks.every((r) => r.text === ' _' && r.color === WORD_SPACE_MARK_COLOR && r.w === undefined));
});

test('word-space marks are off by default and never cross a line break', () => {
  assert.ok(buildLetterRuns('Maja ima muco.').every((r) => r.kind !== 'mark'));
  const runs = buildStyledRuns({ body: 'Maja ima\nmuco', syllableBody: undefined }, { wordSpaceMarks: true });
  assert.equal(runs.filter((r) => r.kind === 'mark').length, 1);
});
