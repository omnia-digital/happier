import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTauriActoolEnvironment } from '../../apps/ui/scripts/tauriActoolEnvironment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('macOS Tauri build and bundle reopen actool stdin without changing tool arguments or environment', {
  skip: process.platform === 'win32' && 'macOS process boundary uses POSIX tools',
}, (t) => {
  const root = fs.mkdtempSync(resolve(os.tmpdir(), 'tauri-actool-stdin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = resolve(root, 'bin');
  const tools = resolve(root, "Xcode tool's $directory");
  const temp = resolve(root, 'tmp');
  for (const dir of [bin, tools, temp]) fs.mkdirSync(dir);
  const platformPreload = resolve(root, 'platform.mjs');
  // The platform and external Xcode/Tauri executables are the only substituted
  // boundaries; the real pipeline, adapter, filesystem, and child process run.
  fs.writeFileSync(platformPreload, "Object.defineProperty(process, 'platform', { value: 'darwin' });\n");
  const realActool = resolve(tools, 'actool');
  const toolSource = resolve(root, 'actool.c');
  // A native fixture is required: Node and some shells reopen fd 0 at startup,
  // hiding the exact OS descriptor contract that Apple actool relies on.
  fs.writeFileSync(toolSource, `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
int main(int argc, char **argv) {
  if (fcntl(0, F_GETFD) < 0) { fprintf(stderr, "actool stdin is closed\\n"); return 42; }
  FILE *capture = fopen(getenv("ACTOOL_CAPTURE"), "wb");
  for (int i = 1; i < argc; i++) fwrite(argv[i], 1, strlen(argv[i]) + 1, capture);
  const char *marker = getenv("ACTOOL_MARKER");
  fwrite(marker, 1, strlen(marker) + 1, capture);
  fclose(capture);
  FILE *pathCapture = fopen(getenv("ACTOOL_PATH_CAPTURE"), "w");
  fputs(getenv("PATH"), pathCapture);
  fclose(pathCapture);
  return getenv("ACTOOL_EXIT") ? atoi(getenv("ACTOOL_EXIT")) : 0;
}
`);
  execFileSync('cc', [toolSource, '-o', realActool]);
  const fakeCli = resolve(root, 'tauri-cli.cjs');
  fs.writeFileSync(fakeCli, `const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const load = Module._load;
// Substitute only the third-party native CLI; execute the real UI entry/adapter.
Module._load = function (id, ...rest) {
  if (id !== '@tauri-apps/cli') return load.call(this, id, ...rest);
  return {
    async run(args) {
      const result = spawnSync('/bin/sh', ['-c', 'exec 0<&-; exec actool "$@"', 'tauri', ...args], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('actool status ' + result.status);
    },
    logError(message) { console.error(message); },
  };
};
`);
  fs.writeFileSync(resolve(bin, 'xcrun'), `#!/bin/sh
[ "$1" = --find ] && [ "$2" = actool ] || exit 43
printf '%s\\n' "$ACTOOL_EXECUTABLE"
`, { mode: 0o755 });
  fs.symlinkSync(realActool, resolve(bin, 'actool'));
  fs.writeFileSync(resolve(bin, 'yarn'), `#!/bin/sh
if [ "$1" = --version ]; then printf '1.22.22\\n'; exit 0; fi
if [ "$1" = -s ]; then exit 0; fi
[ "$1" = tauri ] || exit 44
# Reproduce the inherited FD_CLOEXEC effect of the native Tauri Node CLI.
exec 0<&-
exec actool "--compile" "path with spaces" "quote' dollar$" "$2"
`, { mode: 0o755 });

  const uiDir = resolve(repoRoot, 'apps/ui');
  const packageScripts = JSON.parse(fs.readFileSync(resolve(uiDir, 'package.json'), 'utf8')).scripts;
  assert.equal(packageScripts.tauri, undefined, 'generic third-party CLI must not recursively wrap the pipeline adapter');
  for (const mode of ['build', 'bundle', 'dev', 'preview', 'production']) {
    const capture = resolve(root, `${mode}.args`);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: temp,
      ACTOOL_EXECUTABLE: realActool,
      ACTOOL_CAPTURE: capture,
      ACTOOL_PATH_CAPTURE: `${capture}.path`,
      ACTOOL_MARKER: 'retained environment',
      TAURI_SIGNING_PRIVATE_KEY: 'opaque-boundary-test-key',
      APPLE_SIGNING_IDENTITY: undefined,
    };
    if (mode === 'build') {
      const frozenEnv = Object.freeze({ ...env });
      const adapted = createTauriActoolEnvironment({ env: frozenEnv, platform: 'darwin', tempRoot: temp });
      try {
        assert.equal(frozenEnv.PATH, env.PATH);
        assert.notEqual(adapted.env.PATH, env.PATH);
        assert.equal(adapted.env.ACTOOL_MARKER, env.ACTOOL_MARKER);
      } finally {
        adapted.cleanup();
      }
    }
    const pipeline = mode === 'build' || mode === 'bundle';
    const args = ['--import', platformPreload, resolve(repoRoot, 'scripts/pipeline/tauri/build-updater-artifacts.mjs'),
      '--environment', 'production', '--ui-dir', root, ...(mode === 'bundle' ? ['--bundle-only'] : [])];
    const invoke = (childEnv) => pipeline
      ? spawnSync(process.execPath, args, { env: childEnv, encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', packageScripts[`tauri:build:${mode}`]], {
        cwd: uiDir,
        env: { ...childEnv, NODE_OPTIONS: `--import=${platformPreload} --require=${fakeCli}` },
        encoding: 'utf8',
      });
    const result = invoke(env);
    assert.equal(result.status, 0, result.stderr);
    const toolArgs = fs.readFileSync(capture, 'utf8').split('\0');
    if (pipeline) {
      assert.deepEqual(toolArgs, ['--compile', 'path with spaces', "quote' dollar$", mode, 'retained environment', '']);
    } else {
      assert.equal(toolArgs[0], 'build');
      assert.equal(toolArgs.at(-2), 'retained environment');
      if (mode !== 'production') {
        assert.ok(toolArgs.includes(`src-tauri/tauri.${mode === 'dev' ? 'publicdev' : 'preview'}.conf.json`));
      }
    }
    assert.match(result.stderr, /stdin/i, 'temporary mitigation must be observable');
    const failure = invoke({ ...env, ACTOOL_EXIT: '19' });
    assert.notEqual(failure.status, 0, 'actool failure must not be swallowed');
    const shimDir = fs.readFileSync(`${capture}.path`, 'utf8').split(':')[0];
    assert.equal(fs.existsSync(shimDir), false, 'the actual child shim must be removed after failure');
    assert.equal(fs.readdirSync(temp).some((name) => name.startsWith('happier-actool-')), false,
      'temporary executable directory must be removed after success and failure');
  }
});

test('actool adapter leaves Linux and Windows environments unchanged without requiring Xcode', () => {
  const env = Object.freeze({ PATH: 'unchanged path', MARKER: 'preserved' });
  for (const platform of ['linux', 'win32']) {
    const result = createTauriActoolEnvironment({ platform, env });
    assert.deepEqual(result.env, env);
    assert.notEqual(result.env, env);
    result.cleanup();
    assert.deepEqual(env, { PATH: 'unchanged path', MARKER: 'preserved' });
  }
});

test('tauri build-updater-artifacts script enables Expo Router web modal support', () => {
  const script = fs.readFileSync(resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'build-updater-artifacts.mjs'), 'utf8');

  assert.match(script, /applyExpoWebModalEnv/);
  assert.match(script, /from '\.\.\/expo\/expoWebModalEnv\.mjs'/);
  assert.doesNotMatch(script, /EXPO_UNSTABLE_WEB_MODAL:\s*'1'/);
});

test('tauri build-updater-artifacts script supports preview dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'build-updater-artifacts.mjs'),
      '--environment',
      'preview',
      '--build-version',
      '1.2.3-preview.123',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  // We run the frontend build explicitly and override Tauri's beforeBuildCommand to avoid
  // Corepack/Yarn resolution issues on Windows runners.
  assert.match(out, /\btauri:prepare:build\b/);
  assert.match(out, /tauri\.beforeBuild\.override\.json/);
  assert.match(out, /\byarn tauri build -v\b/);
  assert.match(out, /tauri\.preview\.conf\.json/);
  assert.match(out, /tauri\.version\.override\.json/);
});

test('tauri build-updater-artifacts script supports dev dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'build-updater-artifacts.mjs'),
      '--environment',
      'dev',
      '--build-version',
      '1.2.3-dev.123',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\btauri:prepare:build\b/);
  assert.match(out, /tauri\.beforeBuild\.override\.json/);
  assert.match(out, /\byarn tauri build -v\b/);
  assert.match(out, /tauri\.publicdev\.conf\.json/);
  assert.match(out, /tauri\.version\.override\.json/);
});

test('tauri build-updater-artifacts script supports production dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'build-updater-artifacts.mjs'),
      '--environment',
      'production',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\btauri:prepare:build\b/);
  assert.match(out, /tauri\.beforeBuild\.override\.json/);
  assert.match(out, /\byarn tauri build -v\b/);
  assert.doesNotMatch(out, /tauri\.preview\.conf\.json/);
});
