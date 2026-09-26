/**
 * "Put in order" (handbook §11.6 A2): which sentences a sequencing sheet
 * shows, and in which order. Pure and deterministic — the same text gives
 * the same order every year, seeded by the entry id (not its version).
 *
 * NEVER change hashString or mulberry32 once shipped: a changed hash or
 * PRNG silently re-orders every sequencing sheet a teacher kept. A snapshot
 * test pins the order for two real entries.
 */

import { SEQUENCE_SENTENCES } from '../config.js';

/**
 * FNV-1a, 32-bit.
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded permutation with no fixed point (no sentence stays where it
 * was), for n >= 2.
 * @param {number} n
 * @param {string} seedText
 * @returns {number[]} order[position] = original index
 */
export function seededDerangement(n, seedText) {
  const rng = mulberry32(hashString(seedText));
  for (let attempt = 0; attempt < 100; attempt++) {
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order.every((original, position) => original !== position)) return order;
  }
  return [...Array(n).keys()].map((i) => (i + 1) % n); // rotation: always a derangement
}

/**
 * The sentences a sequencing sheet uses: all of them when there are
 * min–max, the first max when there are more (contiguous sentences keep
 * the story coherent; a sample spread over the text leaves the order
 * ambiguous). Fewer than min: none — the sheet is blocked.
 * @param {number} sentenceCount
 * @returns {number} how many sentences, from the first (0 = too few)
 */
export function sequenceLength(sentenceCount) {
  if (sentenceCount < SEQUENCE_SENTENCES.min) return 0;
  return Math.min(sentenceCount, SEQUENCE_SENTENCES.max);
}
