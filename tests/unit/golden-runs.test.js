import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMBOS, comboLabel, computeGolden } from '../../scripts/lib/golden-runs.mjs';

// Characterization test (upgrade blueprint §11.13): the styled output of every
// bundled text, in every styling combination, must match the committed
// fingerprints exactly. A deliberate visible change regenerates
// tests/golden/runs.json in a commit of its own (scripts/dump-golden-runs.mjs).
test('styled output of every bundled text matches the golden fingerprints', async () => {
  const root = new URL('../../', import.meta.url);
  const golden = JSON.parse(await readFile(new URL('tests/golden/runs.json', root), 'utf8'));
  assert.deepEqual(golden.combos, COMBOS.map(comboLabel), 'combination list changed — regenerate the golden file deliberately');
  const actual = await computeGolden(root);
  const differences = [];
  for (const [key, hashes] of Object.entries(golden.entries)) {
    if (!actual[key]) {
      differences.push(`${key}: entry missing`);
      continue;
    }
    hashes.forEach((hash, i) => {
      if (actual[key][i] !== hash) differences.push(`${key}: ${golden.combos[i]}`);
    });
  }
  for (const key of Object.keys(actual)) if (!golden.entries[key]) differences.push(`${key}: not in golden file`);
  assert.deepEqual(differences.slice(0, 20), [], `${differences.length} differences (first 20 shown); inspect with node scripts/dump-golden-runs.mjs --explain <lang:id>`);
});
