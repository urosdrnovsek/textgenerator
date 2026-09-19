import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePersonalization } from '../../src/text/prepare.js';

test('passes text through unchanged when there is no {name} placeholder', () => {
  const entry = { body: 'Maja ima muco.', syllable_body: 'Ma|ja i|ma mu|co.' };
  const result = resolvePersonalization(entry, 'Ana');
  assert.equal(result.body, entry.body);
  assert.equal(result.syllableBody, entry.syllable_body);
  assert.equal(result.personalized, false);
});

test('uses the authored neutral variant when no name is supplied', () => {
  const entry = {
    body: 'Zgodba o {name}.',
    neutral_body: 'Zgodba o dečku.',
    neutral_syllable_body: 'Zgod|ba o deč|ku.'
  };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Zgodba o dečku.');
  assert.equal(result.syllableBody, 'Zgod|ba o deč|ku.');
  assert.equal(result.personalized, false);
});

test('falls back to blind placeholder removal with whitespace cleanup when there is no neutral_body', () => {
  const entry = { body: 'Zgodba o {name} in zmaju.' };
  const result = resolvePersonalization(entry, undefined);
  assert.equal(result.body, 'Zgodba o in zmaju.');
  assert.equal(result.syllableBody, undefined);
});

test('substitutes a supplied name and drops syllable coloring for the personalized text', () => {
  const entry = { body: 'Zgodba o {name}.', syllable_body: 'ignored' };
  const result = resolvePersonalization(entry, '  Mia  ');
  assert.equal(result.body, 'Zgodba o Mia.');
  assert.equal(result.syllableBody, undefined);
  assert.equal(result.personalized, true);
});

test('capitalizes the next word when a sentence-initial placeholder is blindly removed', () => {
  const entry = { body: 'Ves je moker. {name} ga vzame v roke.' };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Ves je moker. Ga vzame v roke.');
});

test('capitalizes correctly when the placeholder is the very first word of the body', () => {
  const entry = { body: '{name} je poletje preživljal pri babici.' };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Je poletje preživljal pri babici.');
});

test('does not touch capitalization for a mid-sentence placeholder', () => {
  const entry = { body: 'Babica je rekla. In {name} je čakal.' };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Babica je rekla. In je čakal.');
});

test('handles Slovene diacritics as the letter immediately following a removed placeholder', () => {
  const entry = { body: '{name} živi v gozdu.' };
  const result = resolvePersonalization(entry, '');
  assert.equal(result.body, 'Živi v gozdu.');
});
