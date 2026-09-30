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
 * `wordTag` is the language and region the Word file declares, so Word
 * checks the spelling in the text's language, not the PC's (English uses
 * British spelling, hence en-GB).
 *
 * Pure data, no imports: node scripts and tests read it as it is.
 */

/** @type {ReadonlyArray<Readonly<{ code: string, name: string, wordTag: string }>>} */
export const LANGUAGES = Object.freeze([
  Object.freeze({ code: 'sl', name: 'Slovenščina', wordTag: 'sl-SI' }),
  Object.freeze({ code: 'en', name: 'English', wordTag: 'en-GB' }),
  Object.freeze({ code: 'de', name: 'Deutsch', wordTag: 'de-DE' }),
  Object.freeze({ code: 'fr', name: 'Français', wordTag: 'fr-FR' }),
  Object.freeze({ code: 'es', name: 'Español', wordTag: 'es-ES' }),
  Object.freeze({ code: 'ro', name: 'Română', wordTag: 'ro-RO' }),
  Object.freeze({ code: 'sk', name: 'Slovenčina', wordTag: 'sk-SK' }),
  Object.freeze({ code: 'hr', name: 'Hrvatski', wordTag: 'hr-HR' })
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

const WORD_TAGS = new Map(LANGUAGES.map((language) => [language.code, language.wordTag]));

/**
 * @param {string} code
 * @returns {string | undefined} the tag the Word file declares (sl-SI, …); undefined for an unknown code
 */
export function wordLanguageTag(code) {
  return WORD_TAGS.get(code);
}
