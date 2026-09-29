/**
 * The bundled languages: the one list the app, the build, the tests and
 * the verify scripts all read. Menu order; the first is the language the
 * interface starts in (the pilot is Slovene).
 *
 * Adding a language takes three things:
 * 1. `content/<code>.json`, its texts (docs/content-guide.md);
 * 2. `locales/<code>.json`, its interface and sheet strings, with the same
 *    keys as the other locales (a unit test holds them equal);
 * 3. one line here.
 * The build refuses to run while any of the three is missing
 * (scripts/validate-content.mjs).
 *
 * `name` is the language's own name, the same in every interface language
 * (the endonym convention), so it lives here and not in the locale files.
 *
 * Pure data, no imports: node scripts and tests read it as it is.
 */

/** @type {ReadonlyArray<Readonly<{ code: string, name: string }>>} */
export const LANGUAGES = Object.freeze([
  Object.freeze({ code: 'sl', name: 'Slovenščina' }),
  Object.freeze({ code: 'en', name: 'English' }),
  Object.freeze({ code: 'de', name: 'Deutsch' }),
  Object.freeze({ code: 'fr', name: 'Français' }),
  Object.freeze({ code: 'es', name: 'Español' }),
  Object.freeze({ code: 'ro', name: 'Română' })
]);

/** @type {ReadonlyArray<string>} e.g. ['sl', 'en', …] */
export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map((language) => language.code));

export const DEFAULT_LANGUAGE = LANGUAGE_CODES[0];

const NAMES = new Map(LANGUAGES.map((language) => [language.code, language.name]));

/**
 * @param {string} code
 * @returns {string} the language's own name; the code itself for an unknown one
 */
export function languageName(code) {
  return NAMES.get(code) ?? code;
}
