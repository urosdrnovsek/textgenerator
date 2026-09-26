/**
 * The teacher's own texts: checked, placed at a level by their length,
 * and turned into catalog entries next to the bundled ones. Pure; storage
 * lives in src/storage.js and the panel in main.js.
 *
 * An own text has no syllable data (the app never guesses syllables), so
 * syllable supports say so (worksheet/advice.js NO_SYLLABLE_DATA). Its
 * picture is the default one drawn for own texts, or none.
 */

import { OWN_TEXT, LEVEL_WORD_BANDS } from '../config.js';
import { countWords } from '../text/runs.js';

/**
 * @typedef {object} OwnText
 * @property {string} id 'own_…', unique
 * @property {string} language
 * @property {string} theme the theme selected when it was added
 * @property {number} level from its length (levelForWords)
 * @property {string} title
 * @property {string} body
 * @property {boolean} picture true: the default own-text picture; false: none
 */

/**
 * Tidies what the teacher typed: NFC, trimmed, at most one empty line
 * between paragraphs (an authored paragraph break stays a paragraph).
 * @param {{ title: string, body: string }} input
 * @returns {{ ok: true, title: string, body: string } | { ok: false, code: 'OWN_TITLE_MISSING' | 'OWN_TITLE_TOO_LONG' | 'OWN_BODY_MISSING' | 'OWN_BODY_TOO_LONG' }}
 */
export function checkOwnText({ title, body }) {
  const cleanTitle = String(title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const cleanBody = String(body ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
  if (cleanTitle === '') return { ok: false, code: 'OWN_TITLE_MISSING' };
  if (cleanTitle.length > OWN_TEXT.titleMax) return { ok: false, code: 'OWN_TITLE_TOO_LONG' };
  if (!/\p{L}/u.test(cleanBody)) return { ok: false, code: 'OWN_BODY_MISSING' };
  if (cleanBody.length > OWN_TEXT.bodyMax) return { ok: false, code: 'OWN_BODY_TOO_LONG' };
  return { ok: true, title: cleanTitle, body: cleanBody };
}

/**
 * The level whose word band holds this many words (the level menu's
 * bands); shorter than the first band is 1, longer than the last is 5.
 * @param {number} words
 * @returns {number} 1–5
 */
export function levelForWords(words) {
  const index = LEVEL_WORD_BANDS.findIndex(([, max]) => words <= max);
  return index === -1 ? LEVEL_WORD_BANDS.length : index + 1;
}

/**
 * @param {{ title: string, body: string }} checked from checkOwnText
 * @param {{ id: string, language: string, theme: string, picture: boolean }} context
 * @returns {OwnText}
 */
export function makeOwnText(checked, { id, language, theme, picture }) {
  return { id, language, theme, level: levelForWords(countWords(checked.body, language)), title: checked.title, body: checked.body, picture: Boolean(picture) };
}

/**
 * The catalog entry for an own text: like a bundled entry, without
 * syllable data and with the default picture or none (imageId null).
 * @param {OwnText} own
 * @returns {import('./validate.js').ContentEntry & { language: string, own: true }}
 */
export function ownTextEntry(own) {
  return {
    id: own.id,
    version: 1,
    theme: own.theme,
    level: own.level,
    title: own.title,
    body: own.body,
    imageId: own.picture ? OWN_TEXT.imageId : null,
    language: own.language,
    own: true
  };
}

/**
 * Is this a well-formed stored own text? (Anything else in storage is ignored.)
 * @param {unknown} value
 * @returns {boolean}
 */
export function isOwnText(value) {
  return Boolean(value) && typeof value === 'object'
    && typeof value.id === 'string' && value.id.startsWith('own_')
    && typeof value.language === 'string' && typeof value.theme === 'string'
    && Number.isInteger(value.level) && value.level >= 1 && value.level <= 5
    && checkOwnText(value).ok && typeof value.picture === 'boolean';
}
