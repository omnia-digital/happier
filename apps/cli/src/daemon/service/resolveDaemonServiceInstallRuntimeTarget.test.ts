import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeHappierCliChoice } from '@happier-dev/cli-common/firstPartyRuntime';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveDaemonServiceInstallRuntimeTarget,
  resolveManagedDaemonServiceShimPath,
} from './resolveDaemonServiceInstallRuntimeTarget';

const tempDirs: string[] = [];

async function createHappierHomeWithManagedShim(): Promise<Readonly<{ processEnv: NodeJS.ProcessEnv; shimPath: string }>> {
  const happierHomeDir = await mkdtemp(join(tmpdir(), 'happier-service-runtime-choice-'));
  tempDirs.push(happierHomeDir);
  const shimPath = join(happierHomeDir, 'bin', process.platform === 'win32' ? 'happier.exe' : 'happier');
  await mkdir(join(happierHomeDir, 'bin'), { recursive: true });
  await writeFile(shimPath, '#!/bin/sh\n', 'utf8');
  return { processEnv: { HAPPIER_HOME_DIR: happierHomeDir }, shimPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe('the managed shim a background service runs (R12)', () => {
  it('is the installed managed shim while this computer has not chosen its own CLI', async () => {
    const { processEnv, shimPath } = await createHappierHomeWithManagedShim();

    expect(await resolveManagedDaemonServiceShimPath({ targetMode: 'default-following', processEnv })).toBe(shimPath);

    await writeHappierCliChoice({ choice: { mode: 'managed' }, processEnv });
    expect(await resolveManagedDaemonServiceShimPath({ targetMode: 'default-following', processEnv })).toBe(shimPath);
  });

  it('is none once this computer chose "Keep my own", so the service runs the CLI that installs it', async () => {
    const { processEnv } = await createHappierHomeWithManagedShim();
    await writeHappierCliChoice({ choice: { mode: 'own', command: '/usr/local/bin/happier' }, processEnv });

    expect(await resolveManagedDaemonServiceShimPath({ targetMode: 'default-following', processEnv })).toBeNull();
    expect(await resolveManagedDaemonServiceShimPath({ targetMode: 'pinned', channel: 'stable', processEnv })).toBeNull();
  });
});

/** A Homebrew prefix with one `happier` keg, linked the way `brew install` links it. */
async function createHomebrewKeg(prefix: string, version: string): Promise<string> {
  const kegExecutable = join(prefix, 'Cellar', 'happier', version, 'libexec', 'happier');
  await mkdir(join(kegExecutable, '..'), { recursive: true });
  await writeFile(kegExecutable, '#!/bin/sh\n', 'utf8');
  await chmod(kegExecutable, 0o755);
  await mkdir(join(prefix, 'opt'), { recursive: true });
  await rm(join(prefix, 'opt', 'happier'), { force: true });
  await symlink(join('..', 'Cellar', 'happier', version), join(prefix, 'opt', 'happier'));
  return kegExecutable;
}

describe('the runtime a background service records for a Homebrew CLI', () => {
  it.skipIf(process.platform === 'win32')('is the keg-independent opt path, which still resolves after brew upgrade', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'happier-service-runtime-brew-')));
    tempDirs.push(root);
    const prefix = join(root, 'homebrew');
    const happierHomeDir = join(root, 'home');
    await mkdir(happierHomeDir, { recursive: true });
    // A JS runtime is available, so the only question is which launcher the service records.
    const processEnv = { HAPPIER_HOME_DIR: happierHomeDir, HAPPIER_JS_RUNTIME_PATH: process.execPath };
    const stableLauncher = join(prefix, 'opt', 'happier', 'libexec', 'happier');

    // Bun reports `execPath` as the resolved file inside the versioned keg.
    const kegExecutable = await createHomebrewKeg(prefix, '0.2.12');
    expect(await resolveDaemonServiceInstallRuntimeTarget({ currentExecPath: kegExecutable, processEnv }))
      .toEqual({ nodePath: stableLauncher, entryPath: '' });

    // `brew upgrade` installs the next keg, repoints opt and cleans the old keg up; the recorded
    // launcher is still what the expected definition (the drift check) resolves to.
    await createHomebrewKeg(prefix, '0.2.13');
    await rm(join(prefix, 'Cellar', 'happier', '0.2.12'), { recursive: true, force: true });
    expect(await resolveDaemonServiceInstallRuntimeTarget({ allowBootstrap: false, currentExecPath: stableLauncher, processEnv }))
      .toEqual({ nodePath: stableLauncher, entryPath: '' });

    // The drift check builds the expected definition from the CLI runtime's JS runtime path (a
    // managed node, when one is installed); the running Homebrew CLI still decides the launcher.
    const originalExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: join(prefix, 'Cellar', 'happier', '0.2.13', 'libexec', 'happier'),
      configurable: true,
      writable: true,
    });
    try {
      expect(await resolveDaemonServiceInstallRuntimeTarget({ allowBootstrap: false, currentExecPath: originalExecPath, processEnv }))
        .toEqual({ nodePath: stableLauncher, entryPath: '' });
    } finally {
      Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
    }
  });

  it.skipIf(process.platform === 'win32')('leaves an npm CLI running on a Homebrew Node to its JS runtime, never opt/node', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-service-runtime-brew-node-'));
    tempDirs.push(root);
    const prefix = join(root, 'homebrew');
    const nodeKeg = join(prefix, 'Cellar', 'node', '22.9.0', 'bin', 'node');
    await mkdir(join(nodeKeg, '..'), { recursive: true });
    await writeFile(nodeKeg, '#!/bin/sh\n', 'utf8');
    await chmod(nodeKeg, 0o755);
    await mkdir(join(prefix, 'opt'), { recursive: true });
    await symlink(join('..', 'Cellar', 'node', '22.9.0'), join(prefix, 'opt', 'node'));
    const happierHomeDir = join(root, 'home');
    await mkdir(happierHomeDir, { recursive: true });
    const jsRuntime = process.execPath;
    const processEnv = { HAPPIER_HOME_DIR: happierHomeDir, HAPPIER_JS_RUNTIME_PATH: jsRuntime };

    const originalExecPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: nodeKeg, configurable: true, writable: true });
    try {
      const target = await resolveDaemonServiceInstallRuntimeTarget({ currentExecPath: nodeKeg, processEnv });
      expect(target.nodePath).toBe(jsRuntime);
      expect(target.nodePath).not.toBe(join(prefix, 'opt', 'node', 'bin', 'node'));
    } finally {
      Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
    }
  });
});
