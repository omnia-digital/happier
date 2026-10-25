import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { accountSettingsParse } from '@happier-dev/protocol';
import { getProviderCliRuntimeSpec } from '@happier-dev/agents';
import { HAPPIER_CLAUDE_ENDPOINT_STATE_ENV_KEY } from '@/backends/claude/endpointRecovery/claudeEndpointArtifacts';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createExecutableShim } from '@/testkit/fs/executableShim';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

const envKeys = ['PATH', 'HAPPIER_CLAUDE_PATH', 'HOME', 'HAPPIER_HOME_DIR', 'CLAUDE_CONFIG_DIR', 'HAPPIER_CLAUDE_CONFIG_DIR', 'IS_SANDBOX'] as const;
const tempDirs = new Set<string>();
let envScope = createEnvKeyScope(envKeys);
const hiddenClaudeSystemPaths = vi.hoisted(() => new Set<string>());

// Keep host-installed Claude binaries outside this fixture's PATH/HOME sandbox.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    accessSync: (path: Parameters<typeof actual.accessSync>[0], mode?: number) => {
      if (hiddenClaudeSystemPaths.has(String(path))) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return actual.accessSync(path, mode);
    },
  };
});

beforeEach(() => {
  hiddenClaudeSystemPaths.clear();
  for (const candidate of getProviderCliRuntimeSpec('claude').knownCommandCandidates ?? []) {
    if (candidate.kind === 'absolutePath') hiddenClaudeSystemPaths.add(candidate.path);
  }
});

async function createFakeBin(name: string): Promise<{ dir: string; binPath: string }> {
  const isWindows = process.platform === 'win32';
  const binPath = await createExecutableShim({
    dirPrefix: 'happier-claude-spawnhooks-',
    fileName: isWindows ? `${name}.cmd` : name,
    contents: isWindows ? ['@echo off', 'echo ok', ''].join('\r\n') : '#!/bin/sh\necho ok\n',
  });
  const dir = dirname(binPath);
  tempDirs.add(dir);
  return { dir, binPath };
}

afterEach(async () => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
  vi.resetModules();
  for (const dir of tempDirs) {
    await removeTempDir(dir);
  }
  tempDirs.clear();
  hiddenClaudeSystemPaths.clear();
});

describe('claudeDaemonSpawnHooks.validateSpawn', () => {
  it('keeps the admitted unified selection after account defaults change', async () => {
    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    for (const pinned of [true, false]) {
      const selected = claudeDaemonSpawnHooks.resolveTerminalPresentation!({
        host: 'tmux', runtimeSelection: {}, processEnv: {},
        accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: pinned }),
      });
      expect(claudeDaemonSpawnHooks.resolveTerminalPresentation!({
        host: 'tmux', runtimeSelection: {}, processEnv: selected.childEnv ?? {},
        accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: !pinned }),
      }).kind).toBe(selected.kind);
    }
  });
  it('uses the current Herdr pane for unified Claude while preserving detached hosts elsewhere', async () => {
    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    const selection = { host: 'herdr' as const, runtimeSelection: {}, processEnv: {} };
    expect(claudeDaemonSpawnHooks.resolveTerminalPresentation?.({
      ...selection,
      accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: true }),
    })).toMatchObject({
      kind: 'runner',
      startingMode: 'local',
      childEnv: { HAPPIER_CLAUDE_UNIFIED_TERMINAL_PIN: '1' },
    });
    expect(claudeDaemonSpawnHooks.resolveTerminalPresentation?.({
      host: 'tmux',
      runtimeSelection: {},
      processEnv: {},
      accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: true }),
    })).toMatchObject({ kind: 'provider', childEnv: { HAPPIER_CLAUDE_UNIFIED_TERMINAL_PIN: '1' } });
    expect(claudeDaemonSpawnHooks.resolveTerminalPresentation?.({
      ...selection,
      accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: false }),
    })).toMatchObject({ kind: 'runner', startingMode: 'remote', childEnv: { HAPPIER_CLAUDE_UNIFIED_TERMINAL_PIN: '0' } });
  });

  it('keeps a recoverable unified provider in its existing host after account settings change', async () => {
    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    expect(claudeDaemonSpawnHooks.resolveTerminalPresentation?.({
      host: 'herdr',
      accountSettings: accountSettingsParse({ claudeUnifiedTerminalEnabled: false }),
      runtimeSelection: {},
      processEnv: { [HAPPIER_CLAUDE_ENDPOINT_STATE_ENV_KEY]: '{"attachmentId":"existing"}' },
    })).toMatchObject({ kind: 'provider', childEnv: { HAPPIER_CLAUDE_UNIFIED_TERMINAL_PIN: '1' } });
  });

  it('rejects spawn when claude is not resolvable', async () => {
    const homeDir = await createTempDir('happier-claude-spawnhooks-no-cli-home-');
    tempDirs.add(homeDir);
    envScope.patch({
      PATH: '',
      HOME: homeDir,
      HAPPIER_HOME_DIR: homeDir,
      HAPPIER_CLAUDE_PATH: undefined,
    });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    const res = await claudeDaemonSpawnHooks.validateSpawn!({});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected validation to fail');
    expect(res.errorMessage.toLowerCase()).toContain('claude');
    expect(res.errorMessage.toLowerCase()).toContain('system install');
    expect(res.errorMessage).toContain('HAPPIER_CLAUDE_PATH');
  });

  it('allows spawn when claude is on PATH', async () => {
    const { dir } = await createFakeBin('claude');
    envScope.patch({ HAPPIER_CLAUDE_PATH: undefined, PATH: dir });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    const res = await claudeDaemonSpawnHooks.validateSpawn!({});
    expect(res.ok).toBe(true);
  });

  it('allows spawn when HAPPIER_CLAUDE_PATH points to an executable', async () => {
    const { binPath } = await createFakeBin('claude-custom');
    envScope.patch({ PATH: '', HAPPIER_CLAUDE_PATH: binPath });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    const res = await claudeDaemonSpawnHooks.validateSpawn!({});
    expect(res.ok).toBe(true);
  });

  it('allows spawn when HAPPIER_CLAUDE_PATH points to a JavaScript entrypoint file', async () => {
    envScope.patch({ PATH: '' });
    const dir = await createTempDir('happier-claude-spawnhooks-js-');
    tempDirs.add(dir);
    const entryPath = join(dir, 'claude.js');
    await writeFile(entryPath, 'import "./entry.cjs";\n', 'utf8');
    if (process.platform !== 'win32') await chmod(entryPath, 0o644);
    envScope.patch({ HAPPIER_CLAUDE_PATH: entryPath });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    const res = await claudeDaemonSpawnHooks.validateSpawn!({});
    expect(res.ok).toBe(true);
  });
});

describe('claudeDaemonSpawnHooks', () => {
  it('does not expose legacy generic token auth plumbing', async () => {
    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    expect('buildAuthEnv' in claudeDaemonSpawnHooks).toBe(false);
  });
});

describe('claudeDaemonSpawnHooks.buildExtraEnvForChild', () => {
  it('does not force CLAUDE_CONFIG_DIR when no override is set', async () => {
    const homeDir = await createTempDir('happier-claude-spawnhooks-home-');
    tempDirs.add(homeDir);
    envScope.patch({
      HOME: homeDir,
      CLAUDE_CONFIG_DIR: undefined,
      HAPPIER_CLAUDE_CONFIG_DIR: undefined,
    });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    expect(claudeDaemonSpawnHooks.buildExtraEnvForChild?.({} as any)).toEqual({});
  });

  it('publishes an explicit CLAUDE_CONFIG_DIR override when set', async () => {
    envScope.patch({
      CLAUDE_CONFIG_DIR: '/tmp/claude-config',
      HAPPIER_CLAUDE_CONFIG_DIR: undefined,
    });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    expect(claudeDaemonSpawnHooks.buildExtraEnvForChild?.({} as any)).toEqual({
      CLAUDE_CONFIG_DIR: '/tmp/claude-config',
    });
  });

  it('preserves only Claude\'s exact external sandbox assertion for the session runner', async () => {
    envScope.patch({
      CLAUDE_CONFIG_DIR: undefined,
      HAPPIER_CLAUDE_CONFIG_DIR: undefined,
      IS_SANDBOX: '1',
    });

    const { claudeDaemonSpawnHooks } = await import('./spawnHooks');
    expect(claudeDaemonSpawnHooks.buildExtraEnvForChild?.({} as any)).toEqual({
      IS_SANDBOX: '1',
    });

    envScope.patch({ IS_SANDBOX: '0' });
    expect(claudeDaemonSpawnHooks.buildExtraEnvForChild?.({} as any)).toEqual({});
  });
});
