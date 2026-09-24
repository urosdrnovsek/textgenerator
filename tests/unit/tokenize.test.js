import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tokenize, syllableBreakOffsets, wordIndexByOffset } from '../../src/text/tokenize.js';
import { buildStyledRuns, splitRunsIntoSentences } from '../../src/text/runs.js';
import { splitIntoSentences } from '../../src/text/prepare.js';

const words = (doc) => doc.words.map((w) => w.text);

test('words are letters/marks/digits with inner apostrophes and hyphens; punctuation and quotes stay outside', () => {
  const doc = tokenize({ body: '„Don’t go,“ said Mont-Blanc’s l’eau 3 times — well-known!' });
  assert.deepEqual(words(doc), ['Don’t', 'go', 'said', 'Mont-Blanc’s', 'l’eau', '3', 'times', 'well-known']);
  for (const word of doc.words) assert.equal(doc.body.slice(word.start, word.end), word.text);
});

test('word indices are consecutive and each word knows its sentence', () => {
  const doc = tokenize({ body: 'Maja ima muco. Muca spi.\n\nKonec.' });
  assert.deepEqual(doc.words.map((w) => w.w), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(doc.words.map((w) => w.sentence), [0, 0, 0, 1, 1, 2]);
  assert.deepEqual(doc.sentences.map((r) => doc.body.slice(r.start, r.end)), ['Maja ima muco.', 'Muca spi.', 'Konec.']);
});

test('syllable breaks map to body offsets and to each word\'s syllable starts', () => {
  assert.deepEqual(syllableBreakOffsets('Ma|ja i|ma'), [2, 6]);
  const doc = tokenize({ body: 'Maja ima', syllable_body: 'Ma|ja i|ma' });
  assert.deepEqual(doc.words.map((w) => w.syllableStarts), [[0, 2], [5, 6]]);
  assert.equal(doc.hasSyllables, true);
  assert.equal(tokenize({ body: 'Maja' }).hasSyllables, false);
});

test('decomposed (NFD) input tokenizes exactly like composed (NFC) input', () => {
  const composed = tokenize({ body: 'Čaša šola', syllable_body: 'Ča|ša šo|la' });
  const decomposed = tokenize({ body: 'Čaša šola'.normalize('NFD'), syllable_body: 'Ča|ša šo|la'.normalize('NFD') });
  assert.deepEqual(decomposed, composed);
});

test('styled runs carry word and syllable ids, never crossing a word or syllable boundary', () => {
  const runs = buildStyledRuns({ body: 'Maja ima, muco.', syllableBody: 'Ma|ja i|ma, mu|co.' }, { syllableMode: 'both', letterColors: { m: '#B42318' } });
  assert.deepEqual(
    runs.map((r) => [r.text, r.w ?? null, r.syl ?? null, r.kind ?? null]),
    [
      ['Ma', 0, 0, null], ['·', 0, null, 'sep'], ['ja', 0, 1, null], // uppercase M is not letter-coloured by default
      [' ', null, null, 'space'],
      ['i', 1, 0, null], ['·', 1, null, 'sep'], ['m', 1, 1, null], ['a', 1, 1, null], [',', null, null, 'punct'],
      [' ', null, null, 'space'],
      ['m', 2, 0, null], ['u', 2, 0, null], ['·', 2, null, 'sep'], ['co', 2, 1, null], ['.', null, null, 'punct']
    ]
  );
});

test('every bundled text: tokenizer and run metadata invariants hold (property check over all 318 entries)', async () => {
  const root = new URL('../../', import.meta.url);
  for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
    const pack = JSON.parse(await readFile(new URL(`content/${language}.json`, root), 'utf8'));
    for (const entry of pack.entries) {
      const label = `${language}:${entry.id}`;
      const doc = tokenize(entry);
      const wordAt = wordIndexByOffset(doc);

      // Every letter, mark or digit belongs to a word; inside a word, only an apostrophe or hyphen may join them.
      for (let i = 0; i < doc.body.length; i++) {
        const char = doc.body[i];
        if (/[\p{L}\p{M}\p{N}]/u.test(char)) assert.ok(wordAt[i] >= 0, `${label}: offset ${i} "${char}" belongs to no word`);
        else if (wordAt[i] >= 0) assert.match(char, /['’-]/, `${label}: offset ${i} "${char}" inside a word`);
      }
      // Every syllable break lies strictly inside a word (a break next to punctuation or a space would be a content error).
      for (const offset of doc.syllableBreaks) {
        const w = wordAt[offset];
        assert.ok(w >= 0 && offset > doc.words[w].start, `${label}: syllable break at ${offset} is not inside a word`);
      }
      // Each word lies inside the sentence it names.
      for (const word of doc.words) {
        const range = doc.sentences[word.sentence];
        assert.ok(word.start >= range.start && word.end <= range.end, `${label}: word ${word.w} "${word.text}" outside sentence ${word.sentence}`);
      }

      // Word identity is independent of formatting: the word id of every
      // source character is the same in every syllable mode and with or
      // without sentence-per-line.
      let reference = null;
      for (const syllableMode of ['off', 'colors', 'separators', 'both']) {
        for (const sentencePerLine of [false, true]) {
          const runs = buildStyledRuns({ body: entry.body, syllableBody: entry.syllable_body }, { syllableMode });
          const paragraphs = sentencePerLine ? splitRunsIntoSentences(runs, splitIntoSentences(entry.body)) : [runs];
          const ids = [];
          for (const run of paragraphs.flat()) {
            if (run.kind === 'sep' || run.kind === 'space') continue;
            for (const char of run.text) ids.push(run.w ?? -1);
            if (run.w !== undefined) {
              const word = doc.words[run.w];
              assert.ok(word.text.includes(run.text), `${label}: run "${run.text}" is not inside word "${word.text}"`);
            }
          }
          if (reference === null) reference = ids;
          else assert.deepEqual(ids, reference, `${label}: word ids changed with ${syllableMode}/${sentencePerLine}`);
        }
      }
    }
  }
});
