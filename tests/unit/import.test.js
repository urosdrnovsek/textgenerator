import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFilenameToAssetId } from '../../src/import.js';

test('imageFilenameToAssetId strips a simple extension', () => {
  assert.equal(imageFilenameToAssetId('octopus.jpg'), 'octopus');
});

test('imageFilenameToAssetId strips only the final extension, keeping dots in the base name', () => {
  assert.equal(imageFilenameToAssetId('my.best.octopus.jpeg'), 'my.best.octopus');
});

test('imageFilenameToAssetId leaves a filename with no extension unchanged', () => {
  assert.equal(imageFilenameToAssetId('octopus'), 'octopus');
});
