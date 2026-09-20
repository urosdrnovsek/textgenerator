#!/usr/bin/env node
/**
 * Prints where the bundled content actually stands, per language: how the
 * 25 entries are spread over the theme x level grid, how many have been
 * reviewed (and by whom — a native speaker or not), whether the syllable
 * breaks were checked, and how many image pairings are verified rather
 * than merely plausible. The numbers come straight from each entry's
 * `review` object (see docs/content-guide.md), so the way to improve a
 * column is to do the review and record it in the JSON — not to edit this
 * script (0.8.1, workstream I8).
 *
 *   npm run content-status            # all languages
 *   npm run content-status -- de fr   # just those packs
 *
 * Exit code is 0 whenever every pack validates; it is a report, not a gate
 * (`npm run validate-content` is the gate).
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validatePack } from '../src/content/validate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEMES = ['stories', 'animal_facts', 'around_the_world', 'amazing_science', 'nature_seasons'];
const LEVELS = [1, 2, 3, 4, 5];

/**
 * @param {string} name
 * @param {number} count
 * @param {number} total
 */
function line(name, count, total) {
  const pct = total === 0 ? 0 : Math.round((100 * count) / total);
  return `  ${name.padEnd(34)} ${String(count).padStart(3)} / ${total}  (${pct}%)`;
}

/**
 * @param {import('../src/content/validate.js').ContentEntry[]} entries
 */
function report(language, packId, entries) {
  const total = entries.length;
  console.log(`\n${language}  (${packId}, ${total} entries)`);

  // Theme x level grid — the blueprint's target is one entry per cell,
  // so an empty cell here is a content gap a teacher will hit as
  // "No texts for this selection".
  console.log(`  ${'theme'.padEnd(18)}${LEVELS.map((l) => `L${l}`.padStart(5)).join('')}`);
  for (const theme of THEMES) {
    const cells = LEVELS.map((level) => {
      const n = entries.filter((e) => e.theme === theme && e.level === level).length;
      return (n === 0 ? '-' : String(n)).padStart(5);
    });
    console.log(`  ${theme.padEnd(18)}${cells.join('')}`);
  }
  const emptyCells = THEMES.flatMap((theme) =>
    LEVELS.filter((level) => !entries.some((e) => e.theme === theme && e.level === level)).map((level) => `${theme}/L${level}`)
  );
  if (emptyCells.length > 0) console.log(`  empty cells: ${emptyCells.join(', ')}`);

  console.log('');
  const reviewed = entries.filter((e) => e.review.status === 'reviewed');
  console.log(line('status: reviewed', reviewed.length, total));
  console.log(line('status: draft', entries.filter((e) => e.review.status === 'draft').length, total));
  const rejected = entries.filter((e) => e.review.status === 'rejected').length;
  if (rejected > 0) console.log(line('status: rejected', rejected, total));
  console.log(line('reviewed by a native speaker', reviewed.filter((e) => e.review.nativeSpeaker === true).length, total));
  console.log(line('syllable breaks reviewed', entries.filter((e) => e.review.syllablesReviewed === true).length, total));

  const reviewers = new Map();
  for (const e of reviewed) {
    const key = `${e.review.reviewer ?? '(reviewer not recorded)'}${e.review.date ? `, ${e.review.date}` : ''}`;
    reviewers.set(key, (reviewers.get(key) ?? 0) + 1);
  }
  for (const [who, n] of reviewers) console.log(`    ${n} reviewed by ${who}`);

  console.log('');
  for (const accuracy of ['verified', 'plausible', 'mismatch']) {
    const n = entries.filter((e) => e.review.imageAccuracy === accuracy).length;
    if (n > 0 || accuracy !== 'mismatch') console.log(line(`image pairing: ${accuracy}`, n, total));
  }
  const unassessed = entries.filter((e) => e.review.imageAccuracy === undefined).length;
  if (unassessed > 0) console.log(line('image pairing: not assessed', unassessed, total));
}

async function main() {
  const wanted = new Set(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/manifest.json'), 'utf8'));
  const assetIds = new Set(manifest.assets.map((a) => a.id));

  const contentDir = path.join(root, 'content');
  const files = (await readdir(contentDir)).filter((f) => f.endsWith('.json')).sort();
  let ok = true;
  for (const file of files) {
    const language = file.replace(/\.json$/, '');
    if (wanted.size > 0 && !wanted.has(language)) continue;
    const raw = JSON.parse(await readFile(path.join(contentDir, file), 'utf8'));
    const result = validatePack(raw, assetIds);
    if (!result.ok) {
      ok = false;
      console.log(`\n${language}: does not validate (${result.errors.length} error(s)) — run npm run validate-content`);
      continue;
    }
    report(result.pack.language, result.pack.packId, result.pack.entries);
  }
  console.log('');
  if (!ok) process.exitCode = 1;
}

main();
