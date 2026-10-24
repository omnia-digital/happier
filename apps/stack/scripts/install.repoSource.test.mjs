import assert from 'node:assert/strict';
import test from 'node:test';

import { getRepoUrls, resolveRepoSource } from './install.mjs';

test('stack bootstrap selects this fork for a new checkout and preserves explicit source overrides', () => {
  const flags = new Set();
  assert.equal(resolveRepoSource({ flags, env: {} }), 'forks');
  assert.equal(getRepoUrls({ repoSource: 'forks', env: {} }).monorepo,
    'https://github.com/omnia-digital/happier.git');
  assert.equal(resolveRepoSource({ flags: new Set(['--upstream']), env: {} }), 'upstream');
  assert.equal(getRepoUrls({ repoSource: 'upstream', env: {} }).monorepo,
    'https://github.com/happier-dev/happier.git');
  assert.equal(getRepoUrls({ repoSource: 'forks', env: { HAPPIER_STACK_REPO_URL: 'https://example.org/team/happier.git' } }).monorepo,
    'https://example.org/team/happier.git');
});
