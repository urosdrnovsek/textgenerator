import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitIntoSentences } from '../../src/text/prepare.js';

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
