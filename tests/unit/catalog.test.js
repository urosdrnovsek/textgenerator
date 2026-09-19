import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogIndex, findCandidates, chooseEntry, listThemes } from '../../src/content/catalog.js';

const ENTRIES = [
  { id: 'a1', theme: 'stories', level: 1 },
  { id: 'a2', theme: 'stories', level: 1 },
  { id: 'b1', theme: 'stories', level: 2 },
  { id: 'c1', theme: 'animal_facts', level: 1 }
];

test('buildCatalogIndex indexes by id and by theme|level', () => {
  const index = buildCatalogIndex(ENTRIES);
  assert.equal(index.byId.get('b1').id, 'b1');
  assert.equal(index.byThemeLevel.get('stories|1').length, 2);
});

test('findCandidates returns an empty array for an unfilled cell, not undefined or a throw', () => {
  const index = buildCatalogIndex(ENTRIES);
  const result = findCandidates(index, { theme: 'nature_seasons', level: 5 });
  assert.deepEqual(result, []);
});

test('findCandidates returns only entries matching both theme and level', () => {
  const index = buildCatalogIndex(ENTRIES);
  const result = findCandidates(index, { theme: 'stories', level: 1 });
  assert.deepEqual(result.map((e) => e.id).sort(), ['a1', 'a2']);
});

test('chooseEntry returns null for an empty candidate list', () => {
  assert.equal(chooseEntry([], null), null);
});

test('chooseEntry avoids immediate repetition when another candidate exists', () => {
  const candidates = ENTRIES.filter((e) => e.theme === 'stories' && e.level === 1);
  // rng always returns 0 -> would pick index 0 of whatever pool is offered
  const chosen = chooseEntry(candidates, 'a1', () => 0);
  assert.notEqual(chosen.id, 'a1');
});

test('chooseEntry falls back to the only candidate when it equals previousId', () => {
  const candidates = [ENTRIES[2]]; // only b1
  const chosen = chooseEntry(candidates, 'b1', () => 0);
  assert.equal(chosen.id, 'b1');
});

test('chooseEntry is deterministic given an injected rng', () => {
  const candidates = ENTRIES.filter((e) => e.theme === 'stories' && e.level === 1);
  const first = chooseEntry(candidates, null, () => 0.999);
  const second = chooseEntry(candidates, null, () => 0.999);
  assert.equal(first.id, second.id);
});

test('listThemes returns each theme once, in first-seen order', () => {
  const index = buildCatalogIndex(ENTRIES);
  assert.deepEqual(listThemes(index), ['stories', 'animal_facts']);
});
