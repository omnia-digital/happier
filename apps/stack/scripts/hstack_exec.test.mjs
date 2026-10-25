import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createTempFixtureSync } from './testkit/core/temp_fixture.mjs';
import { runCommandCapture } from './testkit/core/run_node_capture.mjs';

const wrapperSource = readFileSync(new URL('../bin/hstack-exec', import.meta.url), 'utf8');
const posixOnly = { skip: process.platform === 'win32' };

function setup(t, { siblingSource, executable = true } = {}) {
  const fixture = createTempFixtureSync(t, { prefix: 'hstack-sibling-exec-' });
  const repo = fixture.path('workspace with spaces', '0.2');
  const wrapper = join(repo, 'apps/stack/bin/hstack-exec');
  const cwd = join(repo, 'packages', 'nested directory');
  mkdirSync(dirname(wrapper), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(wrapper, wrapperSource, { mode: 0o755 });
  if (siblingSource) {
    const sibling = fixture.path('workspace with spaces', '0.3/apps/stack/bin/hstack-exec');
    mkdirSync(dirname(sibling), { recursive: true });
    writeFileSync(sibling, siblingSource, { mode: 0o755 });
    chmodSync(sibling, executable ? 0o755 : 0o644);
  }
  // No executable discovery dependencies may be needed for local execution.
  const env = { ...process.env, PATH: '', HAPPIER_ROUTED_EXECUTOR: '' };
  return { wrapper, repo, cwd, env };
}

test('without a sibling executor preserves local cwd, literal args, stdin, streams and exit', posixOnly, async (t) => {
  const fixture = setup(t);
  const args = ['space value', '$(touch should-not-exist)', 'quote"value', ''];
  const result = await runCommandCapture(fixture.wrapper, [
    '--', '/bin/sh', '-c', 'printf "%s\\0" "$PWD" "$@"; IFS= read -r line; printf "%s" "$line"; printf "local stderr" >&2; exit 37',
    'payload', ...args,
  ], { ...fixture, input: 'input value\n' });
  assert.equal(result.code, 37);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, [realpathSync(fixture.cwd), ...args].join('\0') + '\0input value');
  assert.equal(result.stderr, 'local stderr');
});

test('disabled routing and a non-executable sibling preserve local execution', posixOnly, async (t) => {
  const siblingSource = '#!/bin/sh\nprintf "unexpected delegation"\nexit 88\n';
  for (const disabled of ['0', 'off', 'false', 'disabled']) {
    const fixture = setup(t, { siblingSource });
    const result = await runCommandCapture(fixture.wrapper, ['/bin/sh', '-c', 'printf local; exit 23'], {
      ...fixture, env: { ...fixture.env, HAPPIER_ROUTED_EXECUTOR: disabled },
    });
    assert.equal(result.code, 23, disabled);
    assert.equal(result.stdout, 'local', disabled);
  }
  const fixture = setup(t, { siblingSource, executable: false });
  const result = await runCommandCapture(fixture.wrapper, ['--', '/bin/sh', '-c', 'printf local; exit 23'], fixture);
  assert.equal(result.code, 23);
  assert.equal(result.stdout, 'local');
});

test('usable sibling receives the absolute source repo before unchanged args and retains cwd and exit', posixOnly, async (t) => {
  // The sibling executor is an OS boundary; its actual routing policy belongs to 0.3.
  const fixture = setup(t, {
    siblingSource: '#!/bin/sh\nprintf "%s\\0" "$PWD" "$@"\nprintf "delegate stderr" >&2\nexit 29\n',
  });
  const args = ['--target=worker', '--', '/bin/sh', 'literal space', '$(false)', 'quote"value', '', 'line\nbreak'];
  const result = await runCommandCapture(fixture.wrapper, args, fixture);
  assert.equal(result.code, 29);
  assert.equal(result.stdout, [realpathSync(fixture.cwd), `--repo=${realpathSync(fixture.repo)}`, ...args].join('\0') + '\0');
  assert.equal(result.stderr, 'delegate stderr');
});

test('local and delegated commands retain native signal termination through exec', posixOnly, async (t) => {
  const local = setup(t);
  const localResult = await runCommandCapture(local.wrapper, ['--', '/bin/sh', '-c', 'kill -TERM $$'], local);
  assert.equal(localResult.signal, 'SIGTERM');
  const delegated = setup(t, { siblingSource: '#!/bin/sh\nkill -TERM $$\n' });
  const delegatedResult = await runCommandCapture(delegated.wrapper, ['--', '/bin/sh', '-c', 'exit 0'], delegated);
  assert.equal(delegatedResult.signal, 'SIGTERM');
});
