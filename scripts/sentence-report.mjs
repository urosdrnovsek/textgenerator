// usage: npm run sentence-report [-- --all]
//
// How every bundled text splits into sentences, for a person to read
// before "Put in order" (sentence sequencing, handbook §11.6 A2) ships:
// sequencing shows the sentences as separate items, so a wrong split
// (after "Dr.", inside an ellipsis, after a closing quote) would print a
// broken item. This is a report, not a test: judging a split needs a
// person. It uses the app's one sentence rule (src/text/prepare.js
// splitSentenceRanges), the same one sequencing cuts its items with.
//
// Prints Markdown: a summary per language, then every text with a flagged
// sentence (all its sentences, numbered, flags inline). --all lists every
// text, flagged or not.

import { readFile } from 'node:fs/promises';
import { splitSentenceRanges } from '../src/text/prepare.js';
import { SEQUENCE_SENTENCES } from '../src/config.js';

const LANGUAGES = ['sl', 'en', 'de', 'fr', 'es'];
const showAll = process.argv.includes('--all');

// Tokens that end in a full stop without ending a sentence (lowercase, as typed).
const ABBREVIATIONS = new Set([
  'dr.', 'st.', 'mr.', 'mrs.', 'ms.', 'prof.', 'sv.', 'npr.', 'itd.', 'tj.', 'oz.', 'g.', 'ga.', 'gdč.',
  'z.b.', 'bzw.', 'usw.', 'ca.', 'nr.', 'hr.', 'fr.', 'mme.', 'mlle.', 'etc.', 'sr.', 'sra.', 'srta.', 'ud.', 'uds.', 'p.ej.'
]);
const OPENING = /^[\s»«"'“”‘’(\[¡¿—–-]*/u;

function flagsFor(sentence) {
  const flags = [];
  const words = sentence.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 3) flags.push('SHORT');
  if (words.length > 30) flags.push('LONG');
  const first = sentence.replace(OPENING, '')[0] ?? '';
  if (first && first !== first.toUpperCase() && first === first.toLowerCase()) flags.push('LOWERCASE_START');
  if (!/[.!?][»«"'“”‘’)\]]*$/u.test(sentence)) flags.push('NO_TERMINATOR');
  const last = (sentence.split(/\s+/).at(-1) ?? '').toLowerCase().replace(/[»«"'“”‘’)\]]+$/u, '');
  if (ABBREVIATIONS.has(last) || /^\p{Lu}\.$/u.test(sentence.split(/\s+/).at(-1) ?? '')) flags.push('ABBREVIATION');
  if (/(\.\.\.|…)[»«"'“”‘’)\]]*$/u.test(sentence)) flags.push('ELLIPSIS');
  // A closing mark left over from the previous sentence (French "pas. » Chaque").
  if (/^[»”’)\]]\s/u.test(sentence)) flags.push('STARTS_WITH_CLOSING_MARK');
  return flags;
}

const out = [];
const summary = [];
const flaggedTexts = [];
for (const language of LANGUAGES) {
  const pack = JSON.parse(await readFile(new URL(`../content/${language}.json`, import.meta.url), 'utf8'));
  let tooFew = 0;
  let capped = 0;
  let flaggedSentences = 0;
  let sentences = 0;
  for (const entry of pack.entries) {
    const body = entry.body.normalize('NFC');
    const list = splitSentenceRanges(body).map(({ start, end }) => body.slice(start, end));
    sentences += list.length;
    if (list.length < SEQUENCE_SENTENCES.min) tooFew++;
    if (list.length > SEQUENCE_SENTENCES.max) capped++;
    const flagged = list.map((s) => ({ text: s, flags: flagsFor(s) }));
    const count = flagged.filter((s) => s.flags.length > 0).length;
    flaggedSentences += count;
    if (count > 0 || showAll) flaggedTexts.push({ language, entry, flagged });
  }
  summary.push(`| ${language} | ${pack.entries.length} | ${(sentences / pack.entries.length).toFixed(1)} | ${tooFew} | ${capped} | ${flaggedSentences} |`);
}

out.push('# Sentence report');
out.push('');
out.push(`How the app splits every bundled text into sentences (src/text/prepare.js). "Put in order" uses sentences 1–${SEQUENCE_SENTENCES.max} of a text, and is unavailable for a text with fewer than ${SEQUENCE_SENTENCES.min}.`);
out.push('');
out.push(`| language | texts | sentences per text | fewer than ${SEQUENCE_SENTENCES.min} (no sequencing) | more than ${SEQUENCE_SENTENCES.max} (first ${SEQUENCE_SENTENCES.max} used) | flagged sentences |`);
out.push('| --- | --- | --- | --- | --- | --- |');
out.push(...summary);
out.push('');
out.push('Flags: SHORT (under 3 words), LONG (over 30 words: a missed split?), LOWERCASE_START (a false split?), NO_TERMINATOR (no . ! ? at the end), ABBREVIATION (ends in "Dr.", "npr.", "z.B.", an initial …: a false split?), ELLIPSIS (ends in "..."/"…"), STARTS_WITH_CLOSING_MARK (a quote mark that belongs to the sentence before).');
out.push('');
out.push(showAll ? '## Every text' : '## Texts with a flagged sentence');
for (const { language, entry, flagged } of flaggedTexts) {
  out.push('');
  out.push(`### ${language} · ${entry.id} · level ${entry.level} · ${flagged.length} sentences — ${entry.title}`);
  out.push('');
  flagged.forEach((s, i) => {
    const marker = i < SEQUENCE_SENTENCES.max ? '' : ' (not used)';
    out.push(`${i + 1}. ${s.text}${s.flags.length ? `  **[${s.flags.join(', ')}]**` : ''}${marker}`);
  });
}
console.log(out.join('\n'));
