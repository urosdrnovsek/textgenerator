import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateBlocks } from '../../src/layout/paginate.js';

test('a set of blocks that exactly fills the budget stays on one page', () => {
  const result = paginateBlocks([{ heightMm: 100 }, { heightMm: 100 }, { heightMm: 53 }], 253);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.breaksMm, []);
  assert.equal(result.lastPageUsedMm, 253);
});

test('one block over budget starts a second page', () => {
  const result = paginateBlocks([{ heightMm: 200 }, { heightMm: 60 }], 253);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.breaksMm, [200]);
  assert.equal(result.lastPageUsedMm, 60);
});

test('an atomic block that would overflow the current page is pushed whole to the next page, not split', () => {
  // 200 fits on page 1 alone; the next 100 does not fit in the remaining
  // 53mm, so it moves entirely to page 2 rather than being partially used.
  const result = paginateBlocks([{ heightMm: 200 }, { heightMm: 100 }], 253);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.breaksMm, [200]);
  assert.equal(result.lastPageUsedMm, 100);
});

test('many small blocks accumulate correctly across several pages', () => {
  // 30 blocks of 10mm each = 300mm total; budget 100mm per page -> pages
  // of 10 blocks (100mm), 10 blocks (100mm), 10 blocks (100mm).
  const blocks = Array.from({ length: 30 }, () => ({ heightMm: 10 }));
  const result = paginateBlocks(blocks, 100);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(result.breaksMm, [100, 200]);
  assert.equal(result.lastPageUsedMm, 100);
});

test('a single block taller than the budget is placed alone and overflows that page — pagination does not resolve this, the caller must detect it as blocked', () => {
  const result = paginateBlocks([{ heightMm: 300 }], 253);
  assert.equal(result.pageCount, 1);
  assert.equal(result.lastPageUsedMm, 300, 'the block is placed as-is; 300 > 253 is the caller\'s signal to report BLOCK_TOO_TALL');
});

test('an empty block list produces one empty page', () => {
  const result = paginateBlocks([], 253);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.breaksMm, []);
  assert.equal(result.lastPageUsedMm, 0);
});

test('a block exactly equal to the remaining space fits without starting a new page', () => {
  const result = paginateBlocks([{ heightMm: 200 }, { heightMm: 53 }], 253);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.breaksMm, []);
  assert.equal(result.lastPageUsedMm, 253);
});
