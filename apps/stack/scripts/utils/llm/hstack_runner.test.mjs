import assert from 'node:assert/strict';
import test from 'node:test';

import { buildhstackRunnerShellSnippet } from './hstack_runner.mjs';

test('generated hstack runner requires an explicit fork package for npm fallback', () => {
  const snippet = buildhstackRunnerShellSnippet({ preferLocalBin: false });
  assert.doesNotMatch(snippet, /npx --yes -p @happier-dev\/stack@latest/);
  assert.match(snippet, /HAPPIER_STACK_NPX_PACKAGE/);
});
