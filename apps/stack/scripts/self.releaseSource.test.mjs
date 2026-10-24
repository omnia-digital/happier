import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveStackRuntimeUpdateSource } from './self.mjs';

test('stack self-update uses local fork source unless an npm source is explicit', () => {
  const rootDir = '/tmp/fork-stack-source';
  assert.deepEqual(resolveStackRuntimeUpdateSource({ rootDir, env: {}, to: '' }),
    { spec: rootDir, packageName: null });
  assert.deepEqual(resolveStackRuntimeUpdateSource({
    rootDir, env: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@omnia/happier-stack' }, to: '',
  }), { spec: '@omnia/happier-stack@latest', packageName: '@omnia/happier-stack' });
  assert.deepEqual(resolveStackRuntimeUpdateSource({
    rootDir, env: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@happier-dev/stack' }, to: '0.2.17',
  }), { spec: '@happier-dev/stack@0.2.17', packageName: '@happier-dev/stack' });
  assert.throws(() => resolveStackRuntimeUpdateSource({ rootDir, env: {}, to: '0.2.17' }), /configured npm package/i);
  assert.throws(() => resolveStackRuntimeUpdateSource({
    rootDir, env: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '../other' }, to: '',
  }), /invalid.*package/i);
});

test('stack self check records no upstream npm result when fork package ownership is unconfigured', () => {
  const home = mkdtempSync(join(tmpdir(), 'fork-stack-self-check-'));
  try {
    const result = spawnSync(process.execPath, [new URL('./self.mjs', import.meta.url).pathname, 'check', '--quiet'], {
      encoding: 'utf8', env: { ...process.env, HAPPIER_STACK_HOME_DIR: home,
        HAPPIER_STACK_RUNTIME_DIR: join(home, 'runtime'), HAPPIER_STACK_UPDATE_PACKAGE_NAME: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const cache = JSON.parse(readFileSync(join(home, 'cache', 'update.json'), 'utf8'));
    assert.equal(cache.latest, null);
    assert.equal(cache.updateAvailable, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
