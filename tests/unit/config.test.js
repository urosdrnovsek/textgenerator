import test from 'node:test';
import assert from 'node:assert/strict';
import { mmToPx, pxToMm, ptToMm, mmToTwips, contentWidthMm, contentHeightMm } from '../../src/config.js';

test('mmToPx / pxToMm round-trip', () => {
  const mm = 170;
  const px = mmToPx(mm);
  assert.ok(Math.abs(px - 642.52) < 0.1);
  assert.ok(Math.abs(pxToMm(px) - mm) < 1e-9);
});

test('ptToMm matches the standard point definition', () => {
  // 72pt = 1 inch = 25.4mm
  assert.ok(Math.abs(ptToMm(72) - 25.4) < 1e-9);
});

test('mmToTwips: 25.4mm (1 inch) is 1440 twips', () => {
  assert.equal(mmToTwips(25.4), 1440);
});

test('content width/height subtract margins from A4', () => {
  assert.equal(contentWidthMm(20), 170);
  assert.equal(contentHeightMm(20), 257);
});
