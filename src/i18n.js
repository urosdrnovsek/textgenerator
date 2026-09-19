/**
 * Minimal string lookup by stable ID (blueprint 8.1: "Use stable IDs
 * internally rather than translated labels"). Only `sl` and a draft `en`
 * exist so far — German and French translations are Phase 5 work and need
 * a native-speaking reviewer, not a placeholder file (blueprint 8.3).
 */

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * @param {{ schemaVersion: number, language: string, strings: Record<string, string> }} locale
 * @returns {(key: string, vars?: Record<string, string | number>) => string}
 */
export function createTranslator(locale) {
  return function t(key, vars = {}) {
    const template = locale.strings[key];
    if (template === undefined) {
      throw new Error(`missing translation for key "${key}" in locale "${locale.language}"`);
    }
    return template.replace(PLACEHOLDER_PATTERN, (match, name) =>
      Object.hasOwn(vars, name) ? String(vars[name]) : match
    );
  };
}
