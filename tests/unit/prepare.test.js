import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolvePersonalization, splitIntoSentences } from '../../src/text/prepare.js';

test('passes text through unchanged when there is no {name} placeholder', () => {
  const entry = { body: 'Maja ima muco.', syllable_body: 'Ma|ja i|ma mu|co.' };
  const result = resolvePersonalization(entry, 'Ana');
  assert.equal(result.body, entry.body);
  assert.equal(result.syllableBody, entry.syllable_body);
  assert.equal(result.personalized, false);
});

test('uses name_default when the name field is empty', () => {
  const entry = {
    body: 'Zgodba o {name}.',
    syllable_body: 'Zgod|ba o {name}.',
    name_default: 'Tom',
    name_default_syllables: 'Tom'
  };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Zgodba o Tom.');
  assert.equal(result.syllableBody, 'Zgod|ba o Tom.');
  assert.equal(result.personalized, false);
});

test('uses name_default (falling back to it as syllables) when name_default_syllables is absent', () => {
  const entry = { body: 'Zgodba o {name}.', syllable_body: 'Zgod|ba o {name}.', name_default: 'Tom' };
  const result = resolvePersonalization(entry, undefined);
  assert.equal(result.body, 'Zgodba o Tom.');
  assert.equal(result.syllableBody, 'Zgod|ba o Tom.');
});

test('a typed name overrides name_default and is inserted as a single unsplit syllable chunk', () => {
  const entry = {
    body: 'Zgodba o {name}.',
    syllable_body: 'Zgod|ba o {name}.',
    name_default: 'Tom',
    name_default_syllables: 'Tom'
  };
  const result = resolvePersonalization(entry, '  Mia  ');
  assert.equal(result.body, 'Zgodba o Mia.');
  assert.equal(result.syllableBody, 'Zgod|ba o Mia.');
  assert.equal(result.personalized, true);
});

test('preserves the rest of the passage\'s authored syllable boundaries around the substituted name', () => {
  const entry = {
    body: 'Ves je moker. {name} ga vzame v roke.',
    syllable_body: 'Ves je mo|ker. {name} ga vza|me v ro|ke.',
    name_default: 'Mia',
    name_default_syllables: 'Mi|a'
  };
  const withDefault = resolvePersonalization(entry, '');
  assert.equal(withDefault.body, 'Ves je moker. Mia ga vzame v roke.');
  assert.equal(withDefault.syllableBody, 'Ves je mo|ker. Mi|a ga vza|me v ro|ke.');

  const withTypedName = resolvePersonalization(entry, 'Eva');
  assert.equal(withTypedName.body, 'Ves je moker. Eva ga vzame v roke.');
  assert.equal(withTypedName.syllableBody, 'Ves je mo|ker. Eva ga vza|me v ro|ke.');
});

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
