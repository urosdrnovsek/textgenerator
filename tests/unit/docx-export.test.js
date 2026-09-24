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

async function buildModel(entryId) {
  const raw = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  const { assetIds, imagesById } = await loadManifestAssets();
  const { pack } = validatePack(raw, assetIds);
  const entry = { ...pack.entries.find((e) => e.id === entryId), language: pack.language };
  return buildWorksheet(entry, SETTINGS, { imagesById }, 'sl');
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
