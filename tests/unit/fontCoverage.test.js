import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FONT_FAMILIES, FONT_MISSING_LANGUAGES, FALLBACK_FONT_ID, fontWritesLanguage } from '../../src/config.js';
import { LANGUAGE_CODES, readPack, readLocale } from './helpers.js';

const FONTS = new URL('../../assets/fonts/', import.meta.url);

/**
 * The codepoints a TrueType/OpenType font maps to a glyph, read from its
 * cmap table (subtable formats 4 and 12). The .ttf/.otf files hold the
 * same glyphs as the .woff2 files the browser loads.
 * @param {Buffer} buf
 * @returns {Set<number>}
 */
function cmapCodepoints(buf) {
  let cmap = -1;
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    if (buf.toString('latin1', record, record + 4) === 'cmap') cmap = buf.readUInt32BE(record + 8);
  }
  assert.ok(cmap >= 0, 'no cmap table');
  const covered = new Set();
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.readUInt16BE(ends + s * 2), start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2), rangeOffset = buf.readUInt16BE(rangeOffsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = rangeOffset === 0
            ? (c + delta) & 0xffff
            : ((g) => (g === 0 ? 0 : (g + delta) & 0xffff))(buf.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2));
          if (glyph !== 0) covered.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < buf.readUInt32BE(sub + 12); g++) {
        const record = sub + 16 + g * 12;
        const start = buf.readUInt32BE(record), end = buf.readUInt32BE(record + 4), startGlyph = buf.readUInt32BE(record + 8);
        for (let c = start; c <= end; c++) if (startGlyph + (c - start) !== 0) covered.add(c);
      }
    }
  }
  return covered;
}

/** Every character a language prints on a sheet: its texts and its sheet strings. */
function printedCharacters(language) {
  const locale = readLocale(language);
  const strings = Object.entries(locale.strings ?? locale)
    .filter(([key]) => key.startsWith('sheet.') || key.startsWith('header.'))
    .map(([, value]) => value);
  const texts = readPack(language).entries.flatMap((entry) => [entry.title, entry.body]);
  const characters = new Set([...[...strings, ...texts].join('')].filter((c) => /\S/u.test(c)));
  return [...characters].map((c) => /** @type {number} */ (c.codePointAt(0)));
}

/** Each font's regular and bold files, as sets of codepoints. */
const FONT_FILES = Object.fromEntries(Object.keys(FONT_FAMILIES).map((fontId) => {
  const dir = new URL(`${fontId}/`, FONTS);
  const files = readdirSync(dir).filter((file) => /\.(ttf|otf)$/.test(file));
  return [fontId, files.map((file) => ({ file, covered: cmapCodepoints(readFileSync(new URL(file, dir))) }))];
}));

test('every font writes exactly the languages FONT_MISSING_LANGUAGES leaves it', () => {
  for (const language of LANGUAGE_CODES) {
    const characters = printedCharacters(language);
    for (const [fontId, files] of Object.entries(FONT_FILES)) {
      assert.ok(files.length >= 2, `${fontId}: a regular and a bold file`);
      const missing = [...new Set(files.flatMap(({ covered }) => characters.filter((c) => !covered.has(c))))]
        .map((c) => String.fromCodePoint(c)).join(' ');
      if (fontWritesLanguage(fontId, language)) {
        assert.equal(missing, '', `${fontId} lacks these ${language} letters; add '${language}' to FONT_MISSING_LANGUAGES.${fontId}`);
      } else {
        assert.notEqual(missing, '', `${fontId} has every ${language} letter; take '${language}' out of FONT_MISSING_LANGUAGES.${fontId}`);
      }
    }
  }
});

test('the fallback font writes every language, and the list names only real fonts', () => {
  for (const language of LANGUAGE_CODES) assert.ok(fontWritesLanguage(FALLBACK_FONT_ID, language), language);
  for (const fontId of Object.keys(FONT_MISSING_LANGUAGES)) assert.ok(Object.hasOwn(FONT_FAMILIES, fontId), fontId);
});
