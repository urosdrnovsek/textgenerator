/**
 * The golden (characterization) fingerprint of styled text: for every
 * bundled entry and every combination of the text settings that affect
 * styling, a short hash of exactly which characters appear, in which
 * paragraph, in which colour. Used by scripts/dump-golden-runs.mjs (writes
 * tests/golden/runs.json) and tests/unit/golden-runs.test.js (compares).
 *
 * Run *segmentation* is deliberately not part of the fingerprint: adjacent
 * runs of the same colour are merged first, so refactors may cut runs at
 * word or syllable boundaries (upgrade blueprint §11.5.2) without
 * "changing" the output. Run metadata (w, syl, kind) is ignored too. What
 * a reader sees — text, paragraphing, colour per glyph — must not change
 * unless the golden file is regenerated in a commit of its own.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildWorksheet } from '../../src/worksheet/build.js';

export const LANGUAGES = ['sl', 'en', 'de', 'fr', 'es'];

const BASE_SETTINGS = {
  fontId: 'andika',
  fontSizePt: 16,
  lineHeightMultiplier: 1.4,
  letterSpacingPt: 0.3,
  extraWordSpacePt: 1,
  rulingId: 'standard-3line',
  guideHeightMm: 10,
  syllableColors: ['#1D4ED8', '#B45309'],
  header: { nameLine: true, date: true, title: true },
  marginMm: 20
};
const LETTER_COLORS = { b: '#B42318', d: '#166534', p: '#7C3AED', q: '#B45309' };

/** Every styling-relevant combination, in a fixed order (the order of hashes in the golden file). */
export const COMBOS = [];
for (const letters of [true, false]) {
  for (const syllableMode of ['off', 'colors', 'separators', 'both']) {
    for (const sentencePerLine of [false, true]) {
      for (const writingMode of ['read-copy', 'trace']) {
        COMBOS.push({ letters, syllableMode, sentencePerLine, writingMode });
      }
    }
  }
}

export function comboLabel(combo) {
  return `letters=${combo.letters} syllables=${combo.syllableMode} sentencePerLine=${combo.sentencePerLine} ${combo.writingMode}`;
}

/**
 * @param {import('../../src/text/runs.js').StyledRun[][]} paragraphs
 * @returns {string} one "color<TAB>text" line per same-colour stretch, paragraphs separated by a pilcrow line
 */
export function canonicalParagraphs(paragraphs) {
  return paragraphs
    .map((runs) => {
      const merged = [];
      for (const run of runs) {
        const previous = merged.at(-1);
        if (previous && previous.color === run.color) previous.text += run.text;
        else merged.push({ color: run.color, text: run.text });
      }
      return merged.map((m) => `${m.color}\t${JSON.stringify(m.text)}`).join('\n');
    })
    .join('\n¶\n');
}

export function fingerprint(paragraphs) {
  return createHash('sha256').update(canonicalParagraphs(paragraphs)).digest('hex').slice(0, 12);
}

export async function loadEntries(root) {
  const entries = [];
  for (const language of LANGUAGES) {
    const pack = JSON.parse(await readFile(new URL(`content/${language}.json`, root), 'utf8'));
    for (const entry of pack.entries) entries.push({ ...entry, language });
  }
  return entries;
}

export function buildParagraphs(entry, combo) {
  const settings = {
    ...BASE_SETTINGS,
    letterColors: combo.letters ? LETTER_COLORS : {},
    syllableMode: combo.syllableMode,
    sentencePerLine: combo.sentencePerLine,
    writingMode: combo.writingMode
  };
  const assets = { imagesById: new Map([[entry.imageId, { id: entry.imageId, path: '' }]]) };
  return buildWorksheet(entry, settings, assets, entry.language).bodyParagraphs;
}

/** @returns {Promise<Record<string, string[]>>} "lang:id" -> one fingerprint per COMBOS entry */
export async function computeGolden(root) {
  const result = {};
  for (const entry of await loadEntries(root)) {
    result[`${entry.language}:${entry.id}`] = COMBOS.map((combo) => fingerprint(buildParagraphs(entry, combo)));
  }
  return result;
}
