import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAllContent } from '../../scripts/validate-content.mjs';

test('the real repository content and manifest validate cleanly', async () => {
  const result = await validateAllContent();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
