import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../../src/i18n.js';

const LOCALE = {
  schemaVersion: 1,
  language: 'en',
  strings: {
    'greeting.hello': 'Hello, {name}!',
    'plain': 'No placeholders here.'
  }
};

test('substitutes named placeholders', () => {
  const t = createTranslator(LOCALE);
  assert.equal(t('greeting.hello', { name: 'Mia' }), 'Hello, Mia!');
});

test('returns the string unchanged when there are no placeholders', () => {
  const t = createTranslator(LOCALE);
  assert.equal(t('plain'), 'No placeholders here.');
});

test('leaves an unmatched placeholder literal when no value is supplied', () => {
  const t = createTranslator(LOCALE);
  assert.equal(t('greeting.hello'), 'Hello, {name}!');
});

test('throws a clear error for an unknown key rather than returning undefined', () => {
  const t = createTranslator(LOCALE);
  assert.throws(() => t('does.not.exist'), /missing translation/);
});

test('all bundled locale files expose exactly the same set of keys', async () => {
  const languages = ['sl', 'en', 'de', 'fr', 'es'];
  const keysByLanguage = {};
  for (const lang of languages) {
    const locale = (await import(`../../locales/${lang}.json`, { with: { type: 'json' } })).default;
    keysByLanguage[lang] = Object.keys(locale.strings).sort();
  }
  const [reference, ...rest] = languages;
  for (const lang of rest) {
    assert.deepEqual(keysByLanguage[lang], keysByLanguage[reference], `${lang}.json must define exactly the same keys as ${reference}.json`);
  }
});
