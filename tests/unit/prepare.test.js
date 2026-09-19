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
