/**
 * WorksheetSettings validation. Bad values here would otherwise flow
 * straight into layout/measure.js and silently produce a wrong fit result
 * or a malformed export — this is the boundary that stops that.
 */

import { FONT_FAMILIES, SETTINGS_LIMITS, KNOWN_WRITING_MODES, KNOWN_SYLLABLE_MODES, TINTS_BY_ID } from '../config.js';
import { RULINGS_BY_ID } from '../layout/rulings.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {{ min: number, max: number }} range
 * @param {Array<{ field: string, message: string }>} errors
 */
function checkRange(field, value, range, errors) {
  if (!isFiniteNumber(value)) {
    errors.push({ field, message: `${field} must be a number` });
    return;
  }
  if (value < range.min || value > range.max) {
    errors.push({ field, message: `${field} must be between ${range.min} and ${range.max} (got ${value})` });
  }
}

/**
 * @param {string} field
 * @param {Record<string, unknown> | undefined} colors
 * @param {Array<{ field: string, message: string }>} errors
 */
function checkColorMap(field, colors, errors) {
  if (!colors || typeof colors !== 'object') {
    errors.push({ field, message: `${field} must be an object of letter -> hex color` });
    return;
  }
  for (const [letter, color] of Object.entries(colors)) {
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
      errors.push({ field: `${field}.${letter}`, message: `color for "${letter}" must be a six-digit hex value (got ${JSON.stringify(color)})` });
    }
  }
}

/**
 * @typedef {object} SettingsValidationError
 * @property {string} field
 * @property {string} message
 */

/**
 * @param {import('./build.js').WorksheetSettings} settings
 * @returns {{ ok: true } | { ok: false, errors: SettingsValidationError[] }}
 */
export function validateSettings(settings) {
  /** @type {SettingsValidationError[]} */
  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  if (!settings || typeof settings !== 'object') {
    return { ok: false, errors: [{ field: '(settings)', message: 'settings must be an object' }] };
  }

  if (!Object.hasOwn(FONT_FAMILIES, settings.fontId)) {
    push('fontId', `unknown fontId "${settings.fontId}" — known fonts: ${Object.keys(FONT_FAMILIES).join(', ')}`);
  }

  checkRange('fontSizePt', settings.fontSizePt, SETTINGS_LIMITS.fontSizePt, errors);
  checkRange('lineHeightMultiplier', settings.lineHeightMultiplier, SETTINGS_LIMITS.lineHeightMultiplier, errors);
  checkRange('letterSpacingPt', settings.letterSpacingPt, SETTINGS_LIMITS.letterSpacingPt, errors);
  checkRange('extraWordSpacePt', settings.extraWordSpacePt, SETTINGS_LIMITS.extraWordSpacePt, errors);
  checkRange('guideHeightMm', settings.guideHeightMm, SETTINGS_LIMITS.guideHeightMm, errors);
  checkRange('marginMm', settings.marginMm, SETTINGS_LIMITS.marginMm, errors);

  if (!KNOWN_WRITING_MODES.has(settings.writingMode)) {
    push('writingMode', `unknown writingMode "${settings.writingMode}" — known: ${[...KNOWN_WRITING_MODES].join(', ')}`);
  }

  if (!KNOWN_SYLLABLE_MODES.has(settings.syllableMode)) {
    push('syllableMode', `unknown syllableMode "${settings.syllableMode}" — known: ${[...KNOWN_SYLLABLE_MODES].join(', ')}`);
  }

  if (!Object.hasOwn(RULINGS_BY_ID, settings.rulingId)) {
    push('rulingId', `unknown rulingId "${settings.rulingId}" — known: ${Object.keys(RULINGS_BY_ID).join(', ')}`);
  }

  checkColorMap('letterColors', settings.letterColors, errors);

  if (settings.syllableColors !== undefined) {
    if (!Array.isArray(settings.syllableColors) || settings.syllableColors.length === 0) {
      push('syllableColors', 'syllableColors must be a non-empty array of hex colors');
    } else {
      settings.syllableColors.forEach((color, i) => {
        if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
          push(`syllableColors[${i}]`, `color must be a six-digit hex value (got ${JSON.stringify(color)})`);
        }
      });
    }
  }

  const header = settings.header;
  if (!header || typeof header !== 'object' || typeof header.nameLine !== 'boolean' || typeof header.date !== 'boolean' || typeof header.title !== 'boolean') {
    push('header', 'header must be an object with boolean nameLine, date, and title fields');
  }

  if (settings.sentencePerLine !== undefined && typeof settings.sentencePerLine !== 'boolean') {
    push('sentencePerLine', 'sentencePerLine must be a boolean when present');
  }

  if (settings.tintId !== undefined && !Object.hasOwn(TINTS_BY_ID, settings.tintId)) {
    push('tintId', `unknown tintId "${settings.tintId}" — known: ${Object.keys(TINTS_BY_ID).join(', ')}`);
  }

  if (settings.printTint !== undefined && typeof settings.printTint !== 'boolean') {
    push('printTint', 'printTint must be a boolean when present');
  }

  if (settings.lineStripes !== undefined && typeof settings.lineStripes !== 'boolean') {
    push('lineStripes', 'lineStripes must be a boolean when present');
  }

  if (settings.printStripes !== undefined && typeof settings.printStripes !== 'boolean') {
    push('printStripes', 'printStripes must be a boolean when present');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
