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

test('write about the picture: title, instruction line and a large picture; no passage', () => {
  const model = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'write-own' }, ASSETS, 'sl');
  assert.deepEqual(types(model), ['header', 'title', 'instruction', 'image']);
  assert.deepEqual(model.blocks[2], { type: 'instruction', key: 'write-own' });
  assert.equal(model.blocks[3].size, 'large');
  assert.equal(model.task, 'lines');
  const noLine = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'write-own', header: { ...SETTINGS.header, instructions: false } }, ASSETS, 'sl');
  assert.deepEqual(types(noLine), ['header', 'title', 'image']);
  const drawing = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'write-own', imageSlot: 'drawing-box' }, ASSETS, 'sl');
  assert.deepEqual(types(drawing), ['header', 'title', 'instruction', 'drawingBox']);
});

test('the older modes keep their exact blocks: no instruction line, a normal picture', () => {
  for (const writingMode of ['read-copy', 'trace', 'read-only']) {
    const model = buildWorksheet(ENTRY, { ...SETTINGS, writingMode, header: { ...SETTINGS.header, instructions: true } }, ASSETS, 'sl');
    assert.deepEqual(types(model), ['header', 'title', 'image', 'passage'], writingMode);
    assert.equal(model.blocks[2].size, 'normal');
  }
});

test('every activity instruction has a sheet.instruction string in all five locales', async () => {
  const { readFileSync } = await import('node:fs');
  const { ACTIVITIES: activities } = await import('../../src/worksheet/activities.js');
  const keys = Object.values(activities).map((a) => a.instruction).filter(Boolean);
  assert.ok(keys.length > 0);
  for (const language of ['sl', 'en', 'de', 'fr', 'es']) {
    const { strings } = JSON.parse(readFileSync(new URL(`../../locales/${language}.json`, import.meta.url), 'utf8'));
    for (const key of keys) assert.equal(typeof strings[`sheet.instruction.${key}`], 'string', `${language}: ${key}`);
  }
});

test('fill the gaps: an instruction line, and gaps only in this mode, with one gap width on the passage block', () => {
  const selection = { key: 'sl:t@1', blanks: [1], sentence: null, showAnswers: false };
  const cloze = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'cloze' }, ASSETS, 'sl', selection);
  assert.deepEqual(types(cloze), ['header', 'title', 'instruction', 'image', 'passage']);
  assert.equal(cloze.blocks[2].key, 'cloze');
  const passage = cloze.blocks.at(-1);
  assert.equal(passage.blankWidthEm, 4);
  assert.deepEqual(passage.paragraphs.flat().filter((r) => r.blank).map((r) => r.text), ['ima']);
  const readCopy = buildWorksheet(ENTRY, SETTINGS, ASSETS, 'sl', selection);
  assert.ok(readCopy.bodyParagraphs.flat().every((r) => !r.blank), 'the clicks are kept but not applied in other modes');
  assert.equal(readCopy.blocks.at(-1).blankWidthEm, 0);
  assert.deepEqual(readCopy.selection, selection, 'the selection travels in the model');
});

test('a selection made for another text version is ignored and flagged', () => {
  const stale = { key: 'sl:t@0', blanks: [1], sentence: null, showAnswers: false };
  const model = buildWorksheet(ENTRY, { ...SETTINGS, writingMode: 'cloze' }, ASSETS, 'sl', stale);
  assert.equal(model.selectionReset, true);
  assert.deepEqual(model.selection.blanks, []);
});
