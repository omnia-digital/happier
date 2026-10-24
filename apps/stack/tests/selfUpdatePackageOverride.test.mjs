import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfUpdateHarness } from './testkit/self_update_testkit.mjs';

test('hstack self check uses HAPPIER_STACK_UPDATE_PACKAGE_NAME when set', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-override-' });
  const res = harness.runSelfCommand(['check', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@latest version'));
});

test('hstack self check does not query npm without an explicit fork package', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-default-' });
  const res = harness.runSelfCommand(['check', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '' },
  });
  assert.equal(res.status, 0);
  assert.equal(harness.readNpmArgsLog(), '');
});

test('hstack self check rejects invalid HAPPIER_STACK_UPDATE_PACKAGE_NAME', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-invalid-' });
  const res = harness.runSelfCommand(['check', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '../evil' },
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /invalid HAPPIER_STACK_UPDATE_PACKAGE_NAME package/);
  assert.equal(harness.readNpmArgsLog(), '');
});

test('hstack self check --preview uses next dist-tag with valid package override', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-preview-override-' });
  const res = harness.runSelfCommand(['check', '--preview', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@next version'));
});

test('hstack self check --preview rejects invalid package override without querying npm', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-preview-invalid-' });
  const res = harness.runSelfCommand(['check', '--preview', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: 'not/a/valid/name!' },
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /invalid HAPPIER_STACK_UPDATE_PACKAGE_NAME package/);
  assert.equal(harness.readNpmArgsLog(), '');
});
