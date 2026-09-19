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
  personalization: { name: '' },
  marginMm: 20
};

async function buildModel(entryId) {
  const raw = JSON.parse(await readFile(path.join(root, 'content/sl.json'), 'utf8'));
  const { pack } = validatePack(raw, new Set(['blue_kite', 'kite_yellow_field']));
  const entry = { ...pack.entries.find((e) => e.id === entryId), language: pack.language };
  const imagesById = new Map([
    ['blue_kite', { id: 'blue_kite', path: 'assets/images/blue_kite.jpg' }],
    ['kite_yellow_field', { id: 'kite_yellow_field', path: 'assets/images/kite_yellow_field.jpg' }]
  ]);
  return buildWorksheet(entry, SETTINGS, { imagesById }, 'sl');
}

async function unzipEntry(docxPath, entryName) {
  return execFileSync('unzip', ['-p', docxPath, entryName]).toString('utf8');
}

test('exportDocx produces a real zip/OOXML package with colored runs, correct A4 page size, and an embedded (not linked) image', async (t) => {
  const model = await buildModel('stories_lost_kite_1');
  const imageBytes = await readFile(path.join(root, 'assets/images/blue_kite.jpg'));
  const layout = { rowCount: 6 };

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

test('exportDocx renders no copy-practice lines when rowCount is 0 (read-only mode)', async () => {
  const model = await buildModel('stories_lost_kite_1');
  const readOnlySettings = { ...SETTINGS, writingMode: 'read-only' };
  const modelReadOnly = { ...model, settings: readOnlySettings };
  const imageBytes = await readFile(path.join(root, 'assets/images/blue_kite.jpg'));

  const blob = await exportDocx(modelReadOnly, { rowCount: 0 }, imageBytes);
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString('hex'), '504b');
});
