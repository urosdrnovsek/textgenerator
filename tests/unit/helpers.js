/**
 * The real bundled files, for tests that check every language or the
 * shipped content. Loops go over LANGUAGE_CODES (src/languages.js), so a
 * new language is tested the moment it is registered.
 */

import { readFileSync } from 'node:fs';

export { LANGUAGE_CODES } from '../../src/languages.js';

const ROOT = new URL('../../', import.meta.url);

/** @param {string} relativePath from the repository root, e.g. "content/sl.json" */
export function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, ROOT), 'utf8'));
}

/** @param {string} code e.g. "sl" — a fresh copy each call, so a test may change it */
export function readPack(code) {
  return readJson(`content/${code}.json`);
}

/** @param {string} code */
export function readLocale(code) {
  return readJson(`locales/${code}.json`);
}

/** The id of every bundled asset (assets/manifest.json). */
export const ASSET_IDS = new Set(readJson('assets/manifest.json').assets.map((asset) => asset.id));
