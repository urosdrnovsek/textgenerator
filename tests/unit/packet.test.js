import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKET_MAX_SHEETS, addSnapshot, removeSnapshot, moveSnapshot } from '../../src/worksheet/packet.js';

function sheet(id) {
  return { id, title: `Sheet ${id}`, language: 'sl', level: 1 };
}

test('addSnapshot appends without mutating the original array', () => {
  const packet = [sheet('a')];
  const result = addSnapshot(packet, sheet('b'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.packet.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(packet.map((s) => s.id), ['a'], 'original array must not be mutated');
});

test('addSnapshot refuses past PACKET_MAX_SHEETS', () => {
  const packet = Array.from({ length: PACKET_MAX_SHEETS }, (_, i) => sheet(String(i)));
  const result = addSnapshot(packet, sheet('overflow'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PACKET_FULL');
});

test('removeSnapshot removes only the targeted sheet', () => {
  const packet = [sheet('a'), sheet('b'), sheet('c')];
  const next = removeSnapshot(packet, 'b');
  assert.deepEqual(next.map((s) => s.id), ['a', 'c']);
});

test('removeSnapshot is a no-op for an id that is not present', () => {
  const packet = [sheet('a')];
  const next = removeSnapshot(packet, 'missing');
  assert.deepEqual(next.map((s) => s.id), ['a']);
});

test('moveSnapshot(-1) swaps a sheet with its predecessor', () => {
  const packet = [sheet('a'), sheet('b'), sheet('c')];
  const next = moveSnapshot(packet, 'b', -1);
  assert.deepEqual(next.map((s) => s.id), ['b', 'a', 'c']);
});

test('moveSnapshot(+1) swaps a sheet with its successor', () => {
  const packet = [sheet('a'), sheet('b'), sheet('c')];
  const next = moveSnapshot(packet, 'b', 1);
  assert.deepEqual(next.map((s) => s.id), ['a', 'c', 'b']);
});

test('moveSnapshot is a no-op at the start (-1) or end (+1) boundary', () => {
  const packet = [sheet('a'), sheet('b')];
  assert.deepEqual(moveSnapshot(packet, 'a', -1).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(moveSnapshot(packet, 'b', 1).map((s) => s.id), ['a', 'b']);
});

test('moveSnapshot is a no-op for an id that is not present', () => {
  const packet = [sheet('a'), sheet('b')];
  assert.deepEqual(moveSnapshot(packet, 'missing', 1).map((s) => s.id), ['a', 'b']);
});
