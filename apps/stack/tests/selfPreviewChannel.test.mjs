import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfUpdateHarness } from './testkit/self_update_testkit.mjs';

test('hstack self check --preview uses npm dist-tag next', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-preview-check-' });
  const res = harness.runSelfCommand(['check', '--preview', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@next version'));
});

test('hstack self update --preview installs @next when --to is not provided', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-preview-update-' });
  const res = harness.runSelfCommand(['update', '--preview', '--json'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.split('\n').some((line) => line.startsWith('install ') && line.includes('@company/hstack@next')));
});

test('hstack self update --preview honors explicit --to version over channel tag', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-preview-update-to-' });
  const res = harness.runSelfCommand(['update', '--preview', '--to=1.2.3', '--json'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  const installLine = log
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('install '));
  assert.ok(installLine, `expected install command line in npm log\n${log}`);
  assert.ok(installLine.includes('@company/hstack@1.2.3'), `expected explicit --to spec in install line\n${installLine}`);
  assert.ok(!installLine.includes('@company/hstack@next'), `expected install line to avoid preview dist-tag\n${installLine}`);
});

test('hstack self check --dev uses npm dist-tag next', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-publicdev-check-' });
  const res = harness.runSelfCommand(['check', '--dev', '--quiet'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@next version'));
});

test('hstack self update --channel=dev installs @next when --to is not provided', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-dev-update-' });
  const res = harness.runSelfCommand(['update', '--channel=dev', '--json'], {
    extraEnv: { HAPPIER_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.split('\n').some((line) => line.startsWith('install ') && line.includes('@company/hstack@next')));
});
