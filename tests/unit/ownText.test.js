import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOwnText, levelForWords, makeOwnText, ownTextEntry, isOwnText } from '../../src/content/ownText.js';
import { listOwnTexts, writeOwnTexts, resetAllData } from '../../src/storage.js';
import { buildWorksheet } from '../../src/worksheet/build.js';
import { OWN_TEXT } from '../../src/config.js';

function mockStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('checking what the teacher typed: tidied (NFC, spaces, at most one empty line), and refused with a reason', () => {
  assert.deepEqual(checkOwnText({ title: '  Moj  muc ', body: 'Muc spi.\r\n\r\n\r\n  Zbudi   se. ' }), { ok: true, title: 'Moj muc', body: 'Muc spi.\n\nZbudi se.' });
  assert.deepEqual(checkOwnText({ title: 'Mač', body: 'x' }).title, 'Mač', 'NFC');
  assert.deepEqual(checkOwnText({ title: ' ', body: 'Muc.' }), { ok: false, code: 'OWN_TITLE_MISSING' });
  assert.deepEqual(checkOwnText({ title: 'x'.repeat(81), body: 'Muc.' }), { ok: false, code: 'OWN_TITLE_TOO_LONG' });
  assert.deepEqual(checkOwnText({ title: 'T', body: ' 123 … ' }), { ok: false, code: 'OWN_BODY_MISSING' });
  assert.deepEqual(checkOwnText({ title: 'T', body: 'a'.repeat(2001) }), { ok: false, code: 'OWN_BODY_TOO_LONG' });
});

test('the level comes from the length, with the level menu\'s word bands', () => {
  assert.equal(levelForWords(5), 1);
  assert.equal(levelForWords(40), 1);
  assert.equal(levelForWords(41), 2);
  assert.equal(levelForWords(110), 3);
  assert.equal(levelForWords(160), 4);
  assert.equal(levelForWords(220), 5);
  assert.equal(levelForWords(400), 5);
});

test('an own text becomes a catalog entry: its theme, its level, the default picture or none, no syllable data', () => {
  const checked = checkOwnText({ title: 'Muc', body: 'Maja ima muco. Muca je bela.' });
  const own = makeOwnText(checked, { id: 'own_1', language: 'sl', theme: 'stories', picture: true });
  assert.deepEqual(own, { id: 'own_1', language: 'sl', theme: 'stories', level: 1, title: 'Muc', body: 'Maja ima muco. Muca je bela.', picture: true });
  assert.ok(isOwnText(own));
  const entry = ownTextEntry(own);
  assert.equal(entry.imageId, OWN_TEXT.imageId);
  assert.equal(entry.syllable_body, undefined);
  assert.equal(ownTextEntry({ ...own, picture: false }).imageId, null);
});

test('storage: own texts round-trip; malformed stored items are ignored; "reset all data" clears them', () => {
  const storage = mockStorage();
  const own = makeOwnText(checkOwnText({ title: 'Muc', body: 'Maja ima muco.' }), { id: 'own_1', language: 'sl', theme: 'stories', picture: false });
  assert.equal(writeOwnTexts([own, { id: 'x', title: 'bad' }], storage), true);
  assert.deepEqual(listOwnTexts(storage), [own]);
  storage.setItem('worksheet-own-texts-v1', 'not json');
  assert.deepEqual(listOwnTexts(storage), []);
  writeOwnTexts([own], storage);
  assert.equal(resetAllData(storage), true);
  assert.deepEqual(listOwnTexts(storage), []);
});

const SETTINGS = {
  fontId: 'andika', fontSizePt: 16, lineHeightMultiplier: 1.4, letterSpacingPt: 0, extraWordSpacePt: 0,
  writingMode: 'read-copy', rulingId: 'standard-3line', guideHeightMm: 10, letterColors: {}, syllableMode: 'colors',
  header: { nameLine: true, date: true, title: true }, marginMm: 20
};
const ownEntry = (picture) => ownTextEntry(makeOwnText(checkOwnText({ title: 'Muc', body: 'Maja ima muco. Muca je bela. Rada spi.' }), { id: 'own_1', language: 'sl', theme: 'stories', picture }));
const picture = { id: OWN_TEXT.imageId, path: 'data:image/jpeg;base64,x', width: 512, height: 512 };

test('on the sheet: the default picture, or no picture block at all — and a teacher\'s uploaded image still works', () => {
  const withPicture = buildWorksheet(ownEntry(true), SETTINGS, { imagesById: new Map([[OWN_TEXT.imageId, picture]]) }, 'sl');
  assert.ok(withPicture.blocks.some((b) => b.type === 'image'));
  const without = buildWorksheet(ownEntry(false), SETTINGS, { imagesById: new Map([[OWN_TEXT.imageId, picture]]) }, 'sl');
  assert.equal(without.image, null);
  assert.ok(!without.blocks.some((b) => b.type === 'image'));
  assert.equal(without.hasSyllableData, false);
  // main.js maps a custom image onto the entry's imageId — null for a text without a picture.
  const uploaded = buildWorksheet(ownEntry(false), SETTINGS, { imagesById: new Map([[null, { id: 'custom', path: 'data:x', width: 10, height: 10 }]]) }, 'sl');
  assert.ok(uploaded.blocks.some((b) => b.type === 'image'));
});

test('a bundled text whose picture is missing is still an error', () => {
  assert.throws(() => buildWorksheet({ id: 'b', version: 1, theme: 'stories', level: 1, title: 'T', body: 'Ena. Dva.', imageId: 'missing', language: 'sl' }, SETTINGS, { imagesById: new Map() }, 'sl'), /MISSING_IMAGE/);
});
