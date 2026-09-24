import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitIntoSentences, splitIntoParagraphs } from '../../src/text/prepare.js';

test('splitIntoSentences splits on terminal punctuation', () => {
  assert.deepEqual(
    splitIntoSentences('Maja ima muco. Muca spi. Ali je lačna?'),
    ['Maja ima muco.', 'Muca spi.', 'Ali je lačna?']
  );
});

test('splitIntoSentences treats a paragraph break as a forced boundary', () => {
  assert.deepEqual(
    splitIntoSentences('Prvi odstavek.\n\nDrugi odstavek.'),
    ['Prvi odstavek.', 'Drugi odstavek.']
  );
});

test('splitIntoSentences returns an empty array for empty/whitespace-only text', () => {
  assert.deepEqual(splitIntoSentences(''), []);
  assert.deepEqual(splitIntoSentences('   \n  '), []);
});

test('splitIntoSentences handles text with no terminal punctuation as one sentence', () => {
  assert.deepEqual(splitIntoSentences('brez pike'), ['brez pike']);
});

test('splitIntoSentences: every character of every real content entry survives the split (property check)', async () => {
  const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const pack = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  for (const entry of pack.entries) {
    const sentences = splitIntoSentences(entry.body);
    assert.ok(sentences.length > 0, `${entry.id}: expected at least one sentence`);
    // Joining with a single space must not lose or invent any non-whitespace character.
    const rejoinedNonWhitespace = sentences.join(' ').replace(/\s+/g, '');
    const originalNonWhitespace = entry.body.replace(/\s+/g, '');
    assert.equal(rejoinedNonWhitespace, originalNonWhitespace, `${entry.id}: non-whitespace content must be preserved`);
  }
});

test('splitIntoParagraphs splits on authored newlines, trimming and dropping empty ones', () => {
  assert.deepEqual(splitIntoParagraphs('One. Two.\n\nThree.\n  \nFour. '), ['One. Two.', 'Three.', 'Four.']);
  assert.deepEqual(splitIntoParagraphs('No breaks here.'), ['No breaks here.']);
});

test('splitIntoSentences keeps a quoted exclamation that the sentence continues past (nothing is skipped)', () => {
  // Before 0.10 the quoted part could not be matched and silently vanished.
  assert.deepEqual(
    splitIntoSentences('Tom lief los. „Du kommst nie ans Ziel!“, riefen sie. Er lief weiter.'),
    ['Tom lief los.', '„Du kommst nie ans Ziel!“, riefen sie.', 'Er lief weiter.']
  );
  assert.deepEqual(
    splitIntoSentences('«¡Tú no vas a llegar!», le gritan. Tito sigue.'),
    ['«¡Tú no vas a llegar!», le gritan.', 'Tito sigue.']
  );
});

test('splitIntoSentences covers every bundled text completely: only whitespace falls between sentences', async () => {
  const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
    const pack = JSON.parse(await readFile(path.join(root, `content/${language}.json`), 'utf8'));
    for (const entry of pack.entries) {
      const joined = splitIntoSentences(entry.body).join('').replace(/\s+/g, '');
      assert.equal(joined, entry.body.replace(/\s+/g, ''), `${language}:${entry.id}`);
    }
  }
});
