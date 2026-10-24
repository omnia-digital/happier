import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStackRuntimeInstallSource } from './init.mjs';

test('stack init installs the local fork source', () => {
  const localRoot = '/tmp/fork-stack-source';
  assert.equal(resolveStackRuntimeInstallSource({ cliRootDir: localRoot }), localRoot);
});
