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

/**
 * Everything printed on a sheet that comes from the locale: header labels,
 * the preview's page-break label, and activity instruction lines
 * (`sheet.instruction.<key>`). One builder, so the preview, the print
 * surface, the fit check, packets and the Word export can't disagree.
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
export function sheetLabels(t) {
  return {
    nameLine: t('header.nameLine'),
    date: t('header.date'),
    pageBreak: (n) => t('preview.pageBreak', { n }),
    instruction: (key) => t(`sheet.instruction.${key}`)
  };
}
