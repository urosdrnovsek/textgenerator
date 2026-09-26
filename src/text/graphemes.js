/**
 * Teacher-chosen letter groups ("ch, sch, š") to highlight in the passage
 * (handbook §11.6 B6). Pure. Matching is literal string comparison: a
 * RegExp is never built from what the teacher typed.
 */

import { GRAPHEME_LIMITS, GRAPHEME_COLORS } from '../config.js';

/** A fixed pattern (not built from input): one or more letters or combining marks. */
const LETTERS_ONLY = /^[\p{L}\p{M}]+$/u;

/**
 * @typedef {object} GraphemeGroup
 * @property {string} text NFC, lowercase, 1–GRAPHEME_LIMITS.maxLength characters
 * @property {string} color from GRAPHEME_COLORS, by the group's position
 */

/**
 * Parses the "Highlight letters" field. Groups are comma-separated; blanks
 * and duplicates are dropped. Nothing is applied from invalid input — the
 * caller keeps the previous groups and shows the error.
 * @param {string} input
 * @returns {{ ok: true, groups: GraphemeGroup[] } | { ok: false, code: 'GRAPHEME_INVALID', group: string } | { ok: false, code: 'GRAPHEME_TOO_MANY', max: number }}
 */
export function parseGraphemeInput(input) {
  const texts = [];
  for (const raw of input.split(',')) {
    const text = raw.trim().normalize('NFC').toLowerCase();
    if (text === '') continue;
    if (!isValidGroupText(text)) return { ok: false, code: 'GRAPHEME_INVALID', group: raw.trim() };
    if (!texts.includes(text)) texts.push(text);
  }
  if (texts.length > GRAPHEME_LIMITS.maxGroups) return { ok: false, code: 'GRAPHEME_TOO_MANY', max: GRAPHEME_LIMITS.maxGroups };
  return { ok: true, groups: texts.map((text, i) => ({ text, color: GRAPHEME_COLORS[i] })) };
}

/**
 * @param {string} text already NFC and lowercase
 * @returns {boolean}
 */
export function isValidGroupText(text) {
  const length = [...text].length;
  return length >= 1 && length <= GRAPHEME_LIMITS.maxLength && LETTERS_ONLY.test(text);
}

/**
 * Where the groups occur in the passage: inside words only, scanning left
 * to right, the longest group first at each position, no overlaps. So
 * `sch` wins over `ch` in "Schule", and `ch` still matches in "Buch".
 * Compared in body coordinates; a character whose lowercase form has a
 * different length (Turkish İ) simply doesn't match.
 * @param {import('./tokenize.js').TextDoc} doc
 * @param {GraphemeGroup[]} groups
 * @returns {Array<{ start: number, end: number, color: string }>} ascending, non-overlapping
 */
export function findGraphemeSpans(doc, groups) {
  const sorted = [...groups].sort((a, b) => b.text.length - a.text.length);
  const spans = [];
  for (const word of doc.words) {
    let i = word.start;
    while (i < word.end) {
      const hit = sorted.find((g) => i + g.text.length <= word.end && doc.body.slice(i, i + g.text.length).toLowerCase() === g.text);
      if (hit) {
        spans.push({ start: i, end: i + hit.text.length, color: hit.color });
        i += hit.text.length;
      } else {
        i += 1;
      }
    }
  }
  return spans;
}
