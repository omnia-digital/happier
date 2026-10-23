import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStackFixtureEnv } from './testkit/core/env_scope.mjs';

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(scriptsDir)));

async function waitFor(readValue, { timeoutMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the test-owned Tauri process');
}

async function processState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'stat=', '-p', String(pid)]);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function isRunning(pid) {
  const state = await processState(pid);
  return Boolean(state && !state.startsWith('Z'));
}

function killExactPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function killExactGroup(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 0) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

test('stack process-group shutdown ends the Tauri CLI and native child', { skip: process.platform === 'win32' }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'happier-tauri-shutdown-'));
  const binDir = join(fixture, 'bin');
  const cargoHome = join(fixture, 'cargo');
  const markerPath = join(fixture, 'tauri-pids.json');
  let outer;
  let cliPid;
  let nativePid;
  let cliPgid;

  try {
    for (const app of ['ui', 'cli', 'server']) {
      const appDir = join(fixture, 'apps', app);
      await mkdir(appDir, { recursive: true });
      await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: `fixture-${app}`, version: '1.0.0' }));
    }
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }));

    const tauriDir = join(fixture, 'apps', 'ui', 'src-tauri');
    await mkdir(tauriDir, { recursive: true });
    await writeFile(join(tauriDir, 'tauri.conf.json'), JSON.stringify({ identifier: 'dev.happier.fixture', productName: 'Fixture' }));
    await writeFile(join(tauriDir, 'tauri.publicdev.conf.json'), '{}');
    await writeFile(join(tauriDir, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');

    // Use the real workspace-build owner at its expected monorepo path. Fixture packages
    // have no internal dependencies, so no build is needed before the external PM hook.
    const workspaceScripts = join(fixture, 'scripts', 'workspaces');
    await mkdir(workspaceScripts, { recursive: true });
    await symlink(
      join(repoRoot, 'scripts', 'workspaces', 'ensureWorkspacePackagesBuilt.mjs'),
      join(workspaceScripts, 'ensureWorkspacePackagesBuilt.mjs'),
    );

    await mkdir(binDir, { recursive: true });
    const yarnPath = join(binDir, 'yarn');
    await writeFile(yarnPath, '#!/bin/sh\nexit 0\n');
    await chmod(yarnPath, 0o755);
    const cargoBin = join(cargoHome, 'bin');
    await mkdir(cargoBin, { recursive: true });
    const cargoPath = join(cargoBin, 'cargo');
    await copyFile(process.execPath, cargoPath);
    await chmod(cargoPath, 0o755);

    const cliPath = join(fixture, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    await mkdir(dirname(cliPath), { recursive: true });
    await writeFile(cliPath, [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const native = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'writeFileSync(process.env.TAURI_TEST_MARKER, JSON.stringify({ cliPid: process.pid, nativePid: native.pid }));',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));

    const env = buildStackFixtureEnv({
      baseEnv: process.env,
      stripStackEnv: true,
      storageDir: join(fixture, 'storage'),
      extraEnv: {
        CARGO_HOME: cargoHome,
        HAPPIER_STACK_REPO_DIR: fixture,
        HAPPIER_STACK_TAURI_WAIT_FOR_EXPO: '0',
        TAURI_TEST_MARKER: markerPath,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
      },
    });
    outer = spawn(process.execPath, [join(scriptsDir, 'tauri_dev.mjs')], {
      cwd: fixture,
      env,
      stdio: 'ignore',
      detached: true,
    });
    const marker = await waitFor(async () => {
      try {
        return JSON.parse(await readFile(markerPath, 'utf8'));
      } catch {
        return null;
      }
    });
    cliPid = marker.cliPid;
    nativePid = marker.nativePid;
    assert.equal(await isRunning(cliPid), true);
    assert.equal(await isRunning(nativePid), true);

    const { stdout: pgidOutput } = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(cliPid)]);
    cliPgid = Number(pgidOutput.trim());
    killExactGroup(outer.pid);
    await waitFor(async () => !(await isRunning(cliPid)) && !(await isRunning(nativePid)));
  } finally {
    // The RED version leaves a second group behind; remove only fixture-owned PIDs/groups.
    killExactGroup(outer?.pid);
    if (cliPgid === cliPid) killExactGroup(cliPgid);
    killExactPid(cliPid);
    killExactPid(nativePid);
    await rm(fixture, { recursive: true, force: true });
  }
});
