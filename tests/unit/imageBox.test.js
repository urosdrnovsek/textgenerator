import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContainedImageSizeMm, IMAGE_BOX_MAX_WIDTH_MM, IMAGE_BOX_MAX_HEIGHT_MM } from '../../src/layout/imageBox.js';

test('a square source is contained at the box\'s smaller dimension, staying square', () => {
  const { widthMm, heightMm } = computeContainedImageSizeMm(512, 512);
  assert.equal(widthMm, heightMm);
  assert.equal(widthMm, Math.min(IMAGE_BOX_MAX_WIDTH_MM, IMAGE_BOX_MAX_HEIGHT_MM));
});

test('a wide (landscape) source is width-limited, preserving its aspect ratio', () => {
  // 3:2 source — width-limited (60/300 = 0.2 < 45/200 = 0.225).
  const { widthMm, heightMm } = computeContainedImageSizeMm(300, 200);
  assert.equal(widthMm, 60);
  assert.equal(heightMm, 40);
});

test('a tall (portrait) source is height-limited, preserving its aspect ratio', () => {
  // 2:3 source — height-limited (60/200 = 0.3 > 45/300 = 0.15).
  const { widthMm, heightMm } = computeContainedImageSizeMm(200, 300);
  assert.equal(heightMm, 45);
  assert.equal(widthMm, 30);
});

test('falls back to the full box when dimensions are missing (undefined)', () => {
  const result = computeContainedImageSizeMm(undefined, undefined);
  assert.deepEqual(result, { widthMm: IMAGE_BOX_MAX_WIDTH_MM, heightMm: IMAGE_BOX_MAX_HEIGHT_MM });
});

test('falls back to the full box when dimensions are zero', () => {
  const result = computeContainedImageSizeMm(0, 0);
  assert.deepEqual(result, { widthMm: IMAGE_BOX_MAX_WIDTH_MM, heightMm: IMAGE_BOX_MAX_HEIGHT_MM });
});

test('respects custom box dimensions when provided', () => {
  const { widthMm, heightMm } = computeContainedImageSizeMm(100, 100, 20, 20);
  assert.equal(widthMm, 20);
  assert.equal(heightMm, 20);
});

test('a very wide source never exceeds the box height even at extreme ratios', () => {
  const { widthMm, heightMm } = computeContainedImageSizeMm(10000, 100);
  assert.ok(widthMm <= IMAGE_BOX_MAX_WIDTH_MM + 1e-9);
  assert.ok(heightMm <= IMAGE_BOX_MAX_HEIGHT_MM + 1e-9);
});
