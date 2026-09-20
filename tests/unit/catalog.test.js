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

test('chooseEntry starts with the first candidate when nothing was shown before', () => {
  const candidates = ENTRIES.filter((e) => e.theme === 'stories' && e.level === 1);
  assert.equal(chooseEntry(candidates, null).id, 'a1');
});

test('chooseEntry moves to the next candidate in pack order and wraps around', () => {
  const candidates = ENTRIES.filter((e) => e.theme === 'stories' && e.level === 1);
  assert.equal(chooseEntry(candidates, 'a1').id, 'a2');
  assert.equal(chooseEntry(candidates, 'a2').id, 'a1');
});

test('chooseEntry starts from the first candidate when previousId belongs to another cell', () => {
  const candidates = ENTRIES.filter((e) => e.theme === 'stories' && e.level === 1);
  assert.equal(chooseEntry(candidates, 'b1').id, 'a1');
});

test('chooseEntry falls back to the only candidate when it equals previousId', () => {
  const candidates = [ENTRIES[2]]; // only b1
  assert.equal(chooseEntry(candidates, 'b1').id, 'b1');
});

test('listThemes returns each theme once, in first-seen order', () => {
  const index = buildCatalogIndex(ENTRIES);
  assert.deepEqual(listThemes(index), ['stories', 'animal_facts']);
});
