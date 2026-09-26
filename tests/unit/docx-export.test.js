import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePack } from '../../src/content/validate.js';
import { buildWorksheet } from '../../src/worksheet/build.js';
import { exportDocx } from '../../src/export/docx.js';
import { convertMillimetersToTwip } from 'docx';
import { mmToTwips, mmToPx, LINE_NUMBER_GUTTER_MM } from '../../src/config.js';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const TEST_ENTRY_ID = 'stories_muc_1';

const SETTINGS = {
  fontId: 'andika',
  fontSizePt: 20,
  lineHeightMultiplier: 1.6,
  letterSpacingPt: 0.3,
  extraWordSpacePt: 1,
  writingMode: 'read-copy',
  rulingId: 'standard-3line',
  guideHeightMm: 10,
  letterColors: { b: '#B42318', d: '#166534' },
  syllableMode: 'colors',
  syllableColors: ['#1D4ED8', '#B45309'],
  header: { nameLine: true, date: true, title: true },
  marginMm: 20
};

async function loadManifestAssets() {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  const assetIds = new Set(manifest.assets.map((a) => a.id));
  const imagesById = new Map(manifest.assets.map((a) => [a.id, { id: a.id, path: a.path, width: a.width, height: a.height }]));
  return { assetIds, imagesById };
}

async function buildModel(entryId, settings = SETTINGS) {
  const raw = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  const { assetIds, imagesById } = await loadManifestAssets();
  const { pack } = validatePack(raw, assetIds);
  const entry = { ...pack.entries.find((e) => e.id === entryId), language: pack.language };
  return buildWorksheet(entry, settings, { imagesById }, 'sl');
}

async function imageBytesFor(entryId) {
  const raw = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  const entry = raw.entries.find((e) => e.id === entryId);
  const { imagesById } = await loadManifestAssets();
  return readFile(path.join(root, imagesById.get(entry.imageId).path));
}

async function unzipEntry(docxPath, entryName) {
  return execFileSync('unzip', ['-p', docxPath, entryName]).toString('utf8');
}

test('exportDocx produces a real zip/OOXML package with colored runs, correct A4 page size, and an embedded (not linked) image', async (t) => {
  const model = await buildModel(TEST_ENTRY_ID);
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);
  const layout = { copyBlocks: [6] };

  const blob = await exportDocx(model, layout, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('hex'), '504b', 'docx must be a valid zip (PK signature)');

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const documentXml = await unzipEntry(docxPath, 'word/document.xml');

  // Letter coloring survived the export as colored runs (b = B42318 per SETTINGS).
  assert.ok(documentXml.includes('B42318'), 'expected the confused-letter color for "b" in the run properties');

  // A4 page size in twips (blueprint: convertMillimetersToTwip(210/297)).
  const expectedWidth = convertMillimetersToTwip(210);
  const expectedHeight = convertMillimetersToTwip(297);
  assert.ok(documentXml.includes(`w:w="${expectedWidth}"`), 'expected A4 page width in twips');
  assert.ok(documentXml.includes(`w:h="${expectedHeight}"`), 'expected A4 page height in twips');

  // Image is embedded, not linked to a local/external path.
  const mediaList = execFileSync('unzip', ['-l', docxPath]).toString('utf8');
  assert.match(mediaList, /word\/media\/[\w.-]+\.(jpg|jpeg|png)/i);

  const relsXml = await unzipEntry(docxPath, 'word/_rels/document.xml.rels');
  assert.ok(!relsXml.includes('TargetMode="External"'), 'export must not reference external/linked resources');
});

function extractExtent(documentXml) {
  const match = documentXml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\s*\/>/);
  assert.ok(match, 'expected a <wp:extent> element in the exported document');
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

test('exportDocx sizes the image at its real aspect ratio instead of stretching it into a fixed 60x45 box', async (t) => {
  // All bundled art (including stories_muc_1's) is a 512x512 square — a
  // stretched 60x45 box would report a non-square extent; a correctly
  // contained square image reports a square extent (cx === cy).
  const model = await buildModel(TEST_ENTRY_ID);
  assert.equal(model.image.width, 512, 'sanity check: the fixture image is really square');
  assert.equal(model.image.height, 512);
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);
  const layout = { copyBlocks: [6] };

  const blob = await exportDocx(model, layout, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const documentXml = await unzipEntry(docxPath, 'word/document.xml');
  const { cx, cy } = extractExtent(documentXml);
  assert.equal(cx, cy, `a square source image must produce a square extent (got cx=${cx}, cy=${cy})`);

  // A synthetic 3:2 source must come out at the same ratio, not the old
  // fixed 60x45 (4:3) box.
  const wideModel = { ...model, image: { ...model.image, width: 300, height: 200 } };
  const wideBlob = await exportDocx(wideModel, layout, imageBytes);
  const wideBuffer = Buffer.from(await wideBlob.arrayBuffer());
  const widePath = path.join(tmpDir, 'wide.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(widePath, wideBuffer));
  const wideXml = await unzipEntry(widePath, 'word/document.xml');
  const wideExtent = extractExtent(wideXml);
  const actualRatio = wideExtent.cx / wideExtent.cy;
  assert.ok(Math.abs(actualRatio - 1.5) < 0.01, `expected a 3:2 (1.5) extent ratio for a 300x200 source, got ${actualRatio.toFixed(3)}`);
});

test('exportDocx applies extraWordSpacePt as additional characterSpacing on space runs only', async (t) => {
  // letterSpacingPt=0.3 -> 6 twips on every run; extraWordSpacePt=6 -> +120
  // twips, but only on the whitespace runs (workstream D3).
  const wordSpacingSettings = { ...SETTINGS, extraWordSpacePt: 6, writingMode: 'read-only' };
  const model = { ...(await buildModel(TEST_ENTRY_ID)), settings: wordSpacingSettings };
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);

  const blob = await exportDocx(model, { copyBlocks: [] }, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const documentXml = await unzipEntry(docxPath, 'word/document.xml');
  const spacingValues = [...documentXml.matchAll(/<w:spacing w:val="(\d+)"\/>/g)].map((m) => Number(m[1]));
  assert.ok(spacingValues.includes(6), 'expected the base 6-twip letter spacing on non-space runs');
  assert.ok(spacingValues.includes(126), 'expected 6 + 120 = 126 twips on space runs (letter + word spacing combined)');
});

test('exportDocx sets body line spacing as an EXACT multiple of the font size, not of the font\'s own line height', async (t) => {
  // CSS line-height 1.4 on an 18pt font is 25.2pt = 504 twips. Word's
  // default "auto" rule would instead take 1.4x the font's natural line
  // height — 1.61em for Andika — which with the real font installed pushed
  // every page-filling read-copy worksheet onto a second page (0.8.1, F4).
  const spacingSettings = { ...SETTINGS, fontSizePt: 18, lineHeightMultiplier: 1.4, writingMode: 'read-only' };
  const model = { ...(await buildModel(TEST_ENTRY_ID)), settings: spacingSettings };
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);

  const blob = await exportDocx(model, { copyBlocks: [] }, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const documentXml = await unzipEntry(docxPath, 'word/document.xml');
  const bodySpacing = documentXml.match(/<w:spacing w:line="(\d+)" w:lineRule="(\w+)"\/>/);
  assert.ok(bodySpacing, 'expected a paragraph spacing element with both w:line and w:lineRule');
  assert.equal(Number(bodySpacing[1]), 504, 'expected 1.4 x 18pt = 25.2pt = 504 twips');
  assert.equal(bodySpacing[2], 'exact');
});

test('passage paragraphs switch widow/orphan control off, like the preview (orphans/widows: 1)', async (t) => {
  // With it on (the Word/LibreOffice default), a paragraph's lone first or
  // last line was pulled to the next page, so the file could print one
  // page longer than the app had measured.
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, header: { nameLine: false, date: false, title: false } });
  const xml = await documentXmlOf(model, { copyBlocks: [] }, t);
  const passage = paragraphsOf(xml).filter((p) => p.includes('w:lineRule="exact"'));
  assert.ok(passage.length > 0);
  for (const p of passage) assert.match(p, /<w:widowControl w:val="false"\/>/);
});

test('exportDocx renders no copy-practice lines when copyBlocks is empty (read-only mode)', async () => {
  const model = await buildModel(TEST_ENTRY_ID);
  const readOnlySettings = { ...SETTINGS, writingMode: 'read-only' };
  const modelReadOnly = { ...model, settings: readOnlySettings };
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);

  const blob = await exportDocx(modelReadOnly, { copyBlocks: [] }, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('hex'), '504b');
});

test('exportDocx uses the caller-supplied header labels instead of the hardcoded Slovene defaults', async () => {
  const model = await buildModel(TEST_ENTRY_ID);
  const imageBytes = await imageBytesFor(TEST_ENTRY_ID);
  const layout = { copyBlocks: [6] };

  const blob = await exportDocx(model, layout, imageBytes, { nameLine: 'Nombre:', date: 'Fecha:' });
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  try {
    const documentXml = await unzipEntry(docxPath, 'word/document.xml');
    assert.ok(documentXml.includes('Nombre:'), 'expected the supplied nameLine label in the exported document');
    assert.ok(documentXml.includes('Fecha:'), 'expected the supplied date label in the exported document');
    assert.ok(!documentXml.includes('Ime:') && !documentXml.includes('Datum:'), 'must not fall back to the hardcoded Slovene labels when labels are supplied');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('exportDocx writes authored paragraph breaks as separate paragraphs with the preview\'s gap, never as newlines inside a run', async (t) => {
  // animal_facts_delfin_5 has "\n\n" paragraph breaks. Before 0.10 they went
  // into a single w:t and LibreOffice printed them as two spaces.
  const entryId = 'animal_facts_delfin_5';
  const model = await buildModel(entryId);
  assert.ok(model.bodyParagraphs.length > 1, 'sanity check: the fixture has authored paragraphs');
  const blob = await exportDocx(model, { copyBlocks: [] }, await imageBytesFor(entryId));
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));
  const documentXml = await unzipEntry(docxPath, 'word/document.xml');

  const runTexts = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  assert.ok(runTexts.every((text) => !text.includes('\n')), 'no run may carry a raw newline');
  // 0.25 × 20 pt font size × 20 twips/pt = 100 twips after each body paragraph.
  const gaps = documentXml.match(/<w:spacing w:after="100"/g) ?? [];
  assert.equal(gaps.length, model.bodyParagraphs.length);
});

async function documentXmlOf(model, layout, t, labels) {
  const blob = await exportDocx(model, layout, await imageBytesFor(TEST_ENTRY_ID), labels);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'worksheet-docx-test-'));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));
  const docxPath = path.join(tmpDir, 'worksheet.docx');
  const buffer = Buffer.from(await blob.arrayBuffer());
  await import('node:fs/promises').then((fs) => fs.writeFile(docxPath, buffer));
  return unzipEntry(docxPath, 'word/document.xml');
}

const paragraphsOf = (xml) => xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g) ?? [];

test('line numbers: Word numbers the passage lines only, continuously, with the passage in the same gutter as the preview', async (t) => {
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, lineNumbers: true });
  const xml = await documentXmlOf(model, { copyBlocks: [5, 20] }, t);

  assert.match(xml, /<w:lnNumType w:countBy="1" w:restart="continuous"\/>/);
  const gutterTwips = mmToTwips(LINE_NUMBER_GUTTER_MM);
  const paragraphs = paragraphsOf(xml);
  const passage = paragraphs.filter((p) => p.includes(`<w:ind w:left="${gutterTwips}"/>`));
  const others = paragraphs.filter((p) => !passage.includes(p));
  assert.ok(passage.length >= 1, 'the passage paragraphs are indented by the gutter');
  for (const p of passage) assert.doesNotMatch(p, /suppressLineNumbers/);
  // Header, title, image and the page-break paragraph before the second
  // copy block are all outside the tables; table cell paragraphs are
  // never numbered by Word, so they carry nothing.
  const outsideTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
  const numberedOutside = paragraphsOf(outsideTables).filter((p) => !passage.includes(p));
  assert.equal(numberedOutside.length, 4, 'header, title, image, page break');
  for (const p of numberedOutside) assert.match(p, /<w:suppressLineNumbers\/>/);
  assert.ok(others.length > numberedOutside.length, 'copy-row cell paragraphs exist');
});

test('line numbers off: no numbering, suppression or gutter in the XML', async (t) => {
  const xml = await documentXmlOf(await buildModel(TEST_ENTRY_ID), { copyBlocks: [5, 20] }, t);
  assert.doesNotMatch(xml, /lnNumType|suppressLineNumbers|<w:ind /);
});

test('drawing box: a borderless gap row and a bordered box row of exact heights, no picture, and a paragraph before the copy lines', async (t) => {
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, imageSlot: 'drawing-box' });
  const xml = await documentXmlOf(model, { copyBlocks: [5] }, t);

  assert.doesNotMatch(xml, /<w:drawing>/, 'the text\'s picture is gone');
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g);
  assert.equal(tables.length, 2, 'the drawing box, then the copy lines');
  const heights = [...tables[0].matchAll(/<w:trHeight w:val="(\d+)" w:hRule="exact"\/>/g)].map((m) => Number(m[1]));
  assert.deepEqual(heights, [mmToTwips(4), mmToTwips(90)]);
  const [gapRow, boxRow] = tables[0].match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  assert.doesNotMatch(gapRow, /w:val="single"/);
  assert.equal(boxRow.match(/w:val="single"/g).length, 4, 'four sides');
  // Word merges tables that touch; a paragraph must come between them.
  const between = xml.slice(xml.indexOf(tables[0]) + tables[0].length, xml.indexOf(tables[1]));
  assert.match(between, /^<w:p>|^<w:p /);
});

test('write about the picture: the instruction line, the picture in the large 120 × 90 mm box, no passage, then copy lines', async (t) => {
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, writingMode: 'write-own' });
  const labels = { nameLine: 'Name:', date: 'Date:', instruction: (key) => `instruction:${key}` };
  const xml = await documentXmlOf(model, { copyBlocks: [8] }, t, labels);

  assert.match(xml, /<w:t[^>]*>instruction:write-own<\/w:t>/);
  // 512 × 512 source contained in 120 × 90 mm: 90 × 90 mm, at the exporter's pixel rounding.
  const { cx, cy } = extractExtent(xml);
  assert.equal(cx, cy);
  assert.equal(cx, Math.round(mmToPx(90)) * 9525);
  assert.doesNotMatch(xml, /Muc/, 'the passage is not on the sheet');
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, 'the copy lines');
});

test('an instruction without the locale\'s labels is an error, never a silent fallback', async () => {
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, writingMode: 'write-own' });
  await assert.rejects(exportDocx(model, { copyBlocks: [] }, await imageBytesFor(TEST_ENTRY_ID)), /MISSING_LABEL: sheet\.instruction\.write-own/);
});

test('highlighted letter groups are bold (w:b) and in their colour; nothing else is bold in the passage', async (t) => {
  const { GRAPHEME_COLORS } = await import('../../src/config.js');
  const model = await buildModel(TEST_ENTRY_ID, { ...SETTINGS, header: { nameLine: false, date: false, title: false }, graphemes: [{ text: 'mu', color: GRAPHEME_COLORS[0] }] });
  const xml = await documentXmlOf(model, { copyBlocks: [] }, t);
  const boldRuns = [...xml.matchAll(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr><w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g)].filter((m) => m[1].includes('<w:b/>'));
  assert.ok(boldRuns.length > 0);
  for (const [, props, text] of boldRuns) {
    assert.equal(text.toLowerCase(), 'mu');
    assert.match(props, new RegExp(`w:val="${GRAPHEME_COLORS[0].slice(1)}"`));
  }
});

test('word-space marks export as their own faint runs, and only when switched on', async (t) => {
  const { WORD_SPACE_MARK_COLOR } = await import('../../src/config.js');
  const marked = await documentXmlOf(await buildModel(TEST_ENTRY_ID, { ...SETTINGS, wordSpaceMarks: true }), { copyBlocks: [] }, t);
  const markRuns = [...marked.matchAll(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr><w:t[^>]*>_<\/w:t><\/w:r>/g)];
  assert.ok(markRuns.length > 3);
  for (const [, props] of markRuns) assert.match(props, new RegExp(`w:val="${WORD_SPACE_MARK_COLOR.slice(1)}"`));
  const plain = await documentXmlOf(await buildModel(TEST_ENTRY_ID), { copyBlocks: [] }, t);
  assert.doesNotMatch(plain, />_<\/w:t>/);
});

test('a gap is one underlined run of no-break spaces about the gap width wide, and the answer is not in the file', async (t) => {
  const { CLOZE } = await import('../../src/config.js');
  const { keyFor } = await import('../../src/worksheet/selection.js');
  const plain = await buildModel(TEST_ENTRY_ID);
  const answer = plain.bodyParagraphs.flat().filter((r) => r.w === 3).map((r) => r.text).join('');
  const selection = { key: keyFor(plain.contentKey), blanks: [3], sentence: null, showAnswers: false };
  const raw = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  const { imagesById } = await loadManifestAssets();
  const entry = { ...raw.entries.find((e) => e.id === TEST_ENTRY_ID), language: 'sl' };
  const gapped = buildWorksheet(entry, { ...SETTINGS, writingMode: 'cloze' }, { imagesById }, 'sl', selection);
  const labels = { nameLine: 'Ime:', date: 'Datum:', instruction: () => 'Dopolni.' };
  const xml = await documentXmlOf(gapped, { copyBlocks: [] }, t, labels);
  const gap = xml.match(/<w:r><w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<w:u w:val="single"\/>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr><w:t xml:space="preserve">(\u00A0+)<\/w:t><\/w:r>/);
  assert.ok(gap, 'an underlined run of no-break spaces');
  assert.equal(gap[1].length, Math.round(gapped.blocks.at(-1).blankWidthEm / CLOZE.docxNbspEm));
  assert.doesNotMatch(xml, new RegExp(`>${answer}<`), 'the answer is not in the file');
});
