import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { protectProductionCheckout, updateProductionCheckout } from '../fork/production-checkout.mjs';

const githubUrl = 'https://github.com/omnia-digital/happier.git';
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

function git(cwd, ...args) {
  const result = spawnSync(realGit, args, {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'production-checkout-'));
  const source = join(root, 'source');
  const checkout = join(root, 'production');
  const remote = join(root, 'origin.git');
  const bin = join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  git(source, 'init', '-b', 'production');
  git(source, 'config', 'user.name', 'Fixture');
  git(source, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(source, 'app.txt'), 'stable\n');
  git(source, 'add', 'app.txt'); git(source, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial stable');
  git(root, 'clone', '--bare', source, remote);
  git(root, 'clone', remote, checkout);
  git(checkout, 'remote', 'set-url', 'origin', githubUrl);
  // Git network access is the system boundary; local Git/index/flags stay real.
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'fetch') args[1] = ${JSON.stringify(remote)};
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
    spawnSync('chflags', ['-R', 'nouchg', root]);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, source, checkout, remote };
}

test('protected checkout blocks source edits, new files, staging, commits, branch changes and pushes', { skip: process.platform !== 'darwin' }, (t) => {
  const { checkout } = fixture(t);
  protectProductionCheckout(checkout);
  assert.throws(() => writeFileSync(join(checkout, 'app.txt'), 'edited\n'), /EPERM|EACCES/);
  assert.throws(() => writeFileSync(join(checkout, 'new.txt'), 'new\n'), /EPERM|EACCES/);
  for (const args of [
    ['add', 'app.txt'],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Forbidden'],
    ['switch', '-c', 'forbidden'],
    ['push', 'origin', 'production'],
  ]) {
    const result = spawnSync(realGit, args, { cwd: checkout, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `must reject git ${args.join(' ')}`);
  }
  assert.equal(git(checkout, 'branch', '--show-current'), 'production');
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'stable\n');
});

test('controlled update fast-forwards from origin/production and relocks new and removed paths', { skip: process.platform !== 'darwin' }, (t) => {
  const { checkout, source, remote } = fixture(t);
  protectProductionCheckout(checkout);
  git(source, 'rm', 'app.txt');
  mkdirSync(join(source, 'nested'));
  writeFileSync(join(source, 'nested', 'next.txt'), 'next stable\n');
  git(source, 'add', 'nested'); git(source, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Next stable');
  git(source, 'push', remote, 'production');
  updateProductionCheckout(checkout);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), git(source, 'rev-parse', 'HEAD'));
  assert.equal(readFileSync(join(checkout, 'nested', 'next.txt'), 'utf8'), 'next stable\n');
  assert.throws(() => writeFileSync(join(checkout, 'nested', 'next.txt'), 'edited'), /EPERM|EACCES/);
  assert.throws(() => writeFileSync(join(checkout, 'new.txt'), 'edited'), /EPERM|EACCES/);
  updateProductionCheckout(checkout);
  assert.equal(git(checkout, 'status', '--porcelain'), '');
});

test('protection and updater reject dirty, wrong-branch, wrong-origin and shared worktree checkouts', { skip: process.platform !== 'darwin' }, (t) => {
  const { checkout, root } = fixture(t);
  writeFileSync(join(checkout, 'app.txt'), 'unpublished work\n');
  assert.throws(() => protectProductionCheckout(checkout), /dirty|uncommitted/i);
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'unpublished work\n');
  writeFileSync(join(checkout, 'app.txt'), 'stable\n');
  git(checkout, 'switch', '-c', 'dev');
  assert.throws(() => protectProductionCheckout(checkout), /production/i);
  git(checkout, 'switch', 'production');
  git(checkout, 'remote', 'set-url', 'origin', 'https://github.com/example/unrelated.git');
  assert.throws(() => protectProductionCheckout(checkout), /origin|remote/i);
  git(checkout, 'remote', 'set-url', 'origin', githubUrl);
  git(checkout, 'worktree', 'add', join(root, 'linked'), 'dev');
  assert.throws(() => protectProductionCheckout(checkout), /worktree|independent/i);
  assert.throws(() => updateProductionCheckout(checkout), /protected|worktree|independent/i);
});

test('failed fetch leaves production unchanged and protected', { skip: process.platform !== 'darwin' }, (t) => {
  const { checkout, root } = fixture(t);
  protectProductionCheckout(checkout);
  const before = git(checkout, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'bin', 'git'), '#!/bin/sh\necho "network unavailable" >&2\nexit 1\n', { mode: 0o755 });
  assert.throws(() => updateProductionCheckout(checkout));
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
  assert.throws(() => writeFileSync(join(checkout, 'app.txt'), 'edited'), /EPERM|EACCES/);
});

test('a failed fast-forward relocks the checkout and preserves the previous commit', { skip: process.platform !== 'darwin' }, (t) => {
  const { checkout, root, source, remote } = fixture(t);
  protectProductionCheckout(checkout);
  const before = git(checkout, 'rev-parse', 'HEAD');
  writeFileSync(join(source, 'app.txt'), 'new version\n');
  git(source, 'add', 'app.txt'); git(source, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Next stable');
  git(source, 'push', remote, 'production');
  const shim = join(root, 'bin', 'git');
  writeFileSync(shim, readFileSync(shim, 'utf8').replace(
    'const args = process.argv.slice(2);',
    'const args = process.argv.slice(2); if (args[0] === "merge") { process.stderr.write("merge failed"); process.exit(1); }',
  ));
  assert.throws(() => updateProductionCheckout(checkout), /merge failed/);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
  assert.throws(() => writeFileSync(join(checkout, 'app.txt'), 'edited'), /EPERM|EACCES/);
  assert.throws(() => writeFileSync(join(checkout, 'new.txt'), 'edited'), /EPERM|EACCES/);
});
