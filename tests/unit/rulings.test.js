import test from 'node:test';
import assert from 'node:assert/strict';
import { standardThreeLineRuling, countFullRows, buildRulingRows, getRuling } from '../../src/layout/rulings.js';

test('countFullRows only counts fully-fitting rows, never a clipped partial row', () => {
  assert.equal(countFullRows(25, 10), 2); // 2.5 rows -> 2
  assert.equal(countFullRows(30, 10), 3);
  assert.equal(countFullRows(9, 10), 0);
  assert.equal(countFullRows(-5, 10), 0);
});

test('countFullRows handles a zero line height without dividing by zero', () => {
  assert.equal(countFullRows(50, 0), 0);
});

test('buildRulingRows positions rows back-to-back with no gap or overlap', () => {
  const ruling = standardThreeLineRuling(10);
  const rows = buildRulingRows(ruling, 3);
  assert.deepEqual(rows.map((r) => r.topMm), [0, 10, 20]);
});

test('the standard three-line guide has a solid top, dashed midline, solid baseline', () => {
  const ruling = standardThreeLineRuling(10);
  assert.deepEqual(ruling.guides.map((g) => [g.type, g.offsetMm, g.style]), [
    ['top', 0, 'solid'],
    ['midline', 5, 'dashed'],
    ['baseline', 10, 'solid']
  ]);
});

test('getRuling throws a clear error for an unknown rulingId', () => {
  assert.throws(() => getRuling('french-seyes', 10), /unknown rulingId/);
});
