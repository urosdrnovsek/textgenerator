import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrintReady } from '../../src/export/print.js';

// printWorksheet() is a one-line window.print() passthrough — not unit
// tested, consistent with this project's DOM-touching-code convention
// (verified only via a real browser, see layout/measure.js and
// render/html.js).

test('isPrintReady is true for "fits"', () => {
  assert.equal(isPrintReady({ status: 'fits' }), true);
});

test('isPrintReady is true for "extends" — a longer-than-one-page worksheet is still printable', () => {
  assert.equal(isPrintReady({ status: 'extends' }), true);
});

test('isPrintReady is false for "blocked"', () => {
  assert.equal(isPrintReady({ status: 'blocked' }), false);
});

test('isPrintReady is false for null/undefined without throwing', () => {
  assert.equal(isPrintReady(null), false);
  assert.equal(isPrintReady(undefined), false);
});
