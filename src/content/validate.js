/**
 * Content pack validation.
 *
 * Validates untrusted JSON (bundled or teacher-imported) before it is ever
 * merged into the working catalog. Nothing here touches the DOM or storage.
 */

const KNOWN_LANGUAGES = new Set(['sl', 'en', 'de', 'fr', 'es']);
const KNOWN_THEMES = new Set([
  'stories',
  'animal_facts',
  'around_the_world',
  'amazing_science',
  'nature_seasons'
]);
const KNOWN_REVIEW_STATUSES = new Set(['draft', 'reviewed', 'rejected']);
const ALLOWED_PLACEHOLDERS = new Set(['name']);
const PLACEHOLDER_PATTERN = /\{([a-zA-Z_]+)\}/g;

/**
 * @typedef {object} ContentEntry
 * @property {string} id
 * @property {number} version
 * @property {string} theme
 * @property {number} level
 * @property {string} title
 * @property {string} body
 * @property {string} [syllable_body]
 * @property {string} [neutral_body] required alongside a `{name}` placeholder in body for grammatically-correct personalization
 * @property {string} [neutral_syllable_body]
 * @property {string[]} [sentences] must join with single spaces to reproduce body exactly
 * @property {string} imageId
 * @property {{status: string}} review
 */

/**
 * @typedef {object} ValidationError
 * @property {string} code
 * @property {string} entryId
 * @property {string} field
 * @property {string} message
 */

/**
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text.normalize('NFC');
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks that only the `{name}` placeholder is used in a text field.
 * @param {string} text
 * @returns {string[]} unknown placeholder names found
 */
function findUnknownPlaceholders(text) {
  const unknown = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1])) {
      unknown.push(match[1]);
    }
  }
  return unknown;
}

/**
 * Validates one content entry against schema rules, known asset ids, and
 * the syllable/body equality invariant.
 * @param {unknown} raw
 * @param {Set<string>} assetIds
 * @param {Set<string>} seenIds
 * @returns {{ entry: ContentEntry | null, errors: ValidationError[] }}
 */
function validateEntry(raw, assetIds, seenIds) {
  /** @type {ValidationError[]} */
  const errors = [];
  const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
  const entryId = isNonEmptyString(entry.id) ? entry.id : '(missing id)';

  const push = (code, field, message) => {
    errors.push({ code, entryId, field, message });
  };

  if (!isNonEmptyString(entry.id)) {
    push('MISSING_FIELD', 'id', 'id is required and must be a non-empty string');
  } else if (seenIds.has(entry.id)) {
    push('DUPLICATE_ID', 'id', `duplicate entry id "${entry.id}" in this pack`);
  }

  if (!Number.isInteger(entry.version) || entry.version < 1) {
    push('INVALID_FIELD', 'version', 'version must be a positive integer');
  }

  if (!isNonEmptyString(entry.theme)) {
    push('MISSING_FIELD', 'theme', 'theme is required');
  } else if (!KNOWN_THEMES.has(entry.theme)) {
    push('UNKNOWN_THEME', 'theme', `theme "${entry.theme}" is not a known theme`);
  }

  if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > 5) {
    push('INVALID_FIELD', 'level', 'level must be an integer from 1 to 5');
  }

  if (!isNonEmptyString(entry.title)) {
    push('MISSING_FIELD', 'title', 'title is required');
  }

  let body = null;
  if (!isNonEmptyString(entry.body)) {
    push('MISSING_FIELD', 'body', 'body is required');
  } else {
    body = normalize(entry.body);
    const unknown = findUnknownPlaceholders(body);
    if (unknown.length > 0) {
      push('UNKNOWN_PLACEHOLDER', 'body', `unsupported placeholder(s): ${unknown.join(', ')}`);
    }
  }

  if (entry.syllable_body !== undefined) {
    if (typeof entry.syllable_body !== 'string' || entry.syllable_body.length === 0) {
      push('INVALID_FIELD', 'syllable_body', 'syllable_body must be a non-empty string when present');
    } else if (body !== null) {
      const syllableBody = normalize(entry.syllable_body);
      const stripped = syllableBody.replaceAll('|', '');
      if (stripped !== body) {
        push(
          'SYLLABLE_MISMATCH',
          'syllable_body',
          'syllable_body with "|" removed must exactly reproduce body'
        );
      }
    }
  }

  let neutralBody = null;
  if (entry.neutral_body !== undefined) {
    if (!isNonEmptyString(entry.neutral_body)) {
      push('INVALID_FIELD', 'neutral_body', 'neutral_body must be a non-empty string when present');
    } else {
      neutralBody = normalize(entry.neutral_body);
      if (neutralBody.includes('{name}')) {
        push('INVALID_FIELD', 'neutral_body', 'neutral_body must not itself contain the {name} placeholder');
      }
    }
  }

  if (entry.neutral_syllable_body !== undefined) {
    if (typeof entry.neutral_syllable_body !== 'string' || entry.neutral_syllable_body.length === 0) {
      push('INVALID_FIELD', 'neutral_syllable_body', 'neutral_syllable_body must be a non-empty string when present');
    } else if (neutralBody !== null) {
      const neutralSyllableBody = normalize(entry.neutral_syllable_body);
      if (neutralSyllableBody.replaceAll('|', '') !== neutralBody) {
        push(
          'SYLLABLE_MISMATCH',
          'neutral_syllable_body',
          'neutral_syllable_body with "|" removed must exactly reproduce neutral_body'
        );
      }
    } else {
      push('INVALID_FIELD', 'neutral_syllable_body', 'neutral_syllable_body requires a valid neutral_body to check against');
    }
  }

  if (entry.sentences !== undefined) {
    if (!Array.isArray(entry.sentences) || entry.sentences.length === 0 || !entry.sentences.every(isNonEmptyString)) {
      push('INVALID_FIELD', 'sentences', 'sentences must be a non-empty array of non-empty strings');
    } else if (body !== null) {
      const joined = entry.sentences.map((s) => normalize(s)).join(' ');
      if (joined !== body) {
        push(
          'SENTENCES_MISMATCH',
          'sentences',
          'sentences joined with single spaces must exactly reproduce body'
        );
      }
    }
  }

  if (!isNonEmptyString(entry.imageId)) {
    push('MISSING_FIELD', 'imageId', 'imageId is required');
  } else if (!assetIds.has(entry.imageId)) {
    push('MISSING_IMAGE', 'imageId', `imageId "${entry.imageId}" has no matching asset`);
  }

  const review = /** @type {Record<string, unknown> | undefined} */ (entry.review);
  if (!review || !isNonEmptyString(review.status)) {
    push('MISSING_FIELD', 'review', 'review.status is required');
  } else if (!KNOWN_REVIEW_STATUSES.has(review.status)) {
    push('INVALID_FIELD', 'review.status', `unknown review status "${review.status}"`);
  }

  if (errors.length > 0) {
    return { entry: null, errors };
  }

  seenIds.add(entry.id);

  return {
    entry: {
      id: entry.id,
      version: entry.version,
      theme: entry.theme,
      level: entry.level,
      title: entry.title,
      body,
      syllable_body: typeof entry.syllable_body === 'string' ? normalize(entry.syllable_body) : undefined,
      neutral_body: neutralBody ?? undefined,
      neutral_syllable_body: typeof entry.neutral_syllable_body === 'string' ? normalize(entry.neutral_syllable_body) : undefined,
      sentences: Array.isArray(entry.sentences) ? entry.sentences.map((s) => normalize(s)) : undefined,
      imageId: entry.imageId,
      review: { status: review.status }
    },
    errors: []
  };
}

/**
 * Validates a whole content pack.
 * @param {unknown} raw parsed (but untrusted) JSON
 * @param {Set<string>} assetIds known local asset ids the pack may reference
 * @returns {{ ok: true, pack: { schemaVersion: number, packId: string, language: string, entries: ContentEntry[] } } | { ok: false, errors: ValidationError[] }}
 */
export function validatePack(raw, assetIds) {
  /** @type {ValidationError[]} */
  const errors = [];
  const pack = /** @type {Record<string, unknown>} */ (raw ?? {});

  if (pack.schemaVersion !== 1) {
    errors.push({
      code: 'UNSUPPORTED_SCHEMA',
      entryId: '(pack)',
      field: 'schemaVersion',
      message: `unsupported schemaVersion "${pack.schemaVersion}"`
    });
  }

  if (!isNonEmptyString(pack.packId)) {
    errors.push({ code: 'MISSING_FIELD', entryId: '(pack)', field: 'packId', message: 'packId is required' });
  }

  if (!isNonEmptyString(pack.language) || !KNOWN_LANGUAGES.has(pack.language)) {
    errors.push({
      code: 'INVALID_FIELD',
      entryId: '(pack)',
      field: 'language',
      message: `language must be one of: ${[...KNOWN_LANGUAGES].join(', ')}`
    });
  }

  if (!Array.isArray(pack.entries) || pack.entries.length === 0) {
    errors.push({ code: 'MISSING_FIELD', entryId: '(pack)', field: 'entries', message: 'entries must be a non-empty array' });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const seenIds = new Set();
  /** @type {ContentEntry[]} */
  const entries = [];

  for (const rawEntry of /** @type {unknown[]} */ (pack.entries)) {
    const result = validateEntry(rawEntry, assetIds, seenIds);
    if (result.entry) {
      entries.push(result.entry);
    } else {
      errors.push(...result.errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    pack: {
      schemaVersion: pack.schemaVersion,
      packId: pack.packId,
      language: pack.language,
      entries
    }
  };
}

export { KNOWN_LANGUAGES, KNOWN_THEMES, KNOWN_REVIEW_STATUSES };
