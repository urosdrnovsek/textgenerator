import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES } from '../../src/worksheet/activities.js';
import { KNOWN_WRITING_MODES } from '../../src/config.js';
import { BLOCK_RENDERERS } from '../../src/render/html.js';
import { BLOCK_WRITERS } from '../../src/export/docx.js';
import { buildWorksheet } from '../../src/worksheet/build.js';

const ENTRY = { id: 't', version: 1, theme: 'stories', level: 1, title: 'Naslov', body: 'Maja ima muco.', imageId: 'img', language: 'sl' };
const ASSETS = { imagesById: new Map([['img', { id: 'img', path: 'data:image/jpeg;base64,x' }]]) };
const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'read-copy', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: {}, syllableMode: 'off',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
const types = (model) => model.blocks.map((b) => b.type);

test('the writing modes are exactly the rows of the activities table', () => {
  assert.deepEqual([...KNOWN_WRITING_MODES].sort(), Object.keys(ACTIVITIES).sort());
});

test('the HTML and DOCX adapters handle exactly the same block types', () => {
  assert.deepEqual(Object.keys(BLOCK_RENDERERS).sort(), Object.keys(BLOCK_WRITERS).sort());
});

test('blocks follow the page order, and header/title blocks exist only when switched on', () => {
  assert.deepEqual(types(buildWorksheet(ENTRY, SETTINGS, ASSETS, 'sl')), ['header', 'title', 'image', 'passage']);
  const bare = buildWorksheet(ENTRY, { ...SETTINGS, header: { nameLine: false, date: false, title: false } }, ASSETS, 'sl');
  assert.deepEqual(types(bare), ['image', 'passage']);
  const dateOnly = buildWorksheet(ENTRY, { ...SETTINGS, header: { nameLine: false, date: true, title: false } }, ASSETS, 'sl');
  assert.deepEqual(dateOnly.blocks[0], { type: 'header', nameLine: false, date: true });
});

test('the task comes from the activity: copy lines only for read-and-copy', () => {
  assert.equal(buildWorksheet(ENTRY, SETTINGS, ASSETS, 'sl').task, 'lines');
  assert.equal(buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'trace' }, ASSETS, 'sl').task, 'none');
  assert.equal(buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'read-only' }, ASSETS, 'sl').task, 'none');
});

test('the passage block shows the styled text (lightened in trace mode)', () => {
  const model = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'trace' }, ASSETS, 'sl');
  const passage = model.blocks.find((b) => b.type === 'passage');
  assert.equal(passage.paragraphs, model.bodyParagraphs);
  assert.notEqual(passage.paragraphs[0][0].color, '#202020');
});

test('an unknown writing mode is a programmer error, not a silent default', () => {
  assert.throws(() => buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'dance' }, ASSETS, 'sl'), /UNKNOWN_WRITING_MODE/);
});

test('the passage block carries the line-numbers switch', () => {
  const passage = (settings) => buildWorksheet(ENTRY, settings, ASSETS, 'sl').blocks.find((b) => b.type === 'passage');
  assert.equal(passage(SETTINGS).lineNumbers, false);
  assert.equal(passage({ ...SETTINGS, lineNumbers: true }).lineNumbers, true);
});

test('the image slot: the picture above the passage, a drawing box after it, or neither', () => {
  assert.deepEqual(types(buildWorksheet(ENTRY, { ...SETTINGS, imageSlot: 'picture' }, ASSETS, 'sl')), ['header', 'title', 'image', 'passage']);
  const drawing = buildWorksheet(ENTRY, { ...SETTINGS, imageSlot: 'drawing-box' }, ASSETS, 'sl');
  assert.deepEqual(types(drawing), ['header', 'title', 'passage', 'drawingBox']);
  assert.deepEqual(drawing.blocks.at(-1), { type: 'drawingBox', heightMm: 90 });
  assert.deepEqual(types(buildWorksheet(ENTRY, { ...SETTINGS, imageSlot: 'none' }, ASSETS, 'sl')), ['header', 'title', 'passage']);
});
