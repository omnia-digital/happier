import { mkdirSync, writeFileSync } from 'node:fs';
import type { SpawnSyncOptions } from 'node:child_process';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSystemdServiceUnit } from '@happier-dev/cli-common/service';
import { resolveInstalledFirstPartyComponentPaths } from '@happier-dev/cli-common/firstPartyRuntime';
import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { resolveDaemonServiceCliRuntimeFromEnv } from '@/daemon/service/cli';
import { planDaemonServiceInstall } from '@/daemon/service/plan';
import { resolveBackgroundServiceRepairPlanForCurrentRuntime } from '@/diagnostics/backgroundServiceRepair/resolveBackgroundServiceRepairPlanForCurrentRuntime';
import { maybeRunDoctorRepair } from './maybeRunDoctorRepair';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn((_command: string, _args: readonly string[], _options: SpawnSyncOptions) => ({ status: 0 })),
}));
// The installed CLI is a process boundary; service discovery and repair planning stay real.
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: spawnSyncMock,
}));

afterEach(() => { vi.restoreAllMocks(); spawnSyncMock.mockReset(); spawnSyncMock.mockReturnValue({ status: 0 }); });

describe('post-update repair', () => {
  it('skips follow-up already handled by migration', async () => {
    expect(await maybeRunDoctorRepair({ migrationRan: true, channel: 'stable' })).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('keeps an update without service repairs out of the interactive repair flow', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'post-update-no-repair-', env: {
      HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux', HAPPIER_DAEMON_SERVICE_CHANNEL: 'stable',
      HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable', HAPPIER_DAEMON_SERVICE_NODE_PATH: process.execPath,
    } }, async () => {
      expect(await maybeRunDoctorRepair({ migrationRan: false, channel: 'stable' })).toBe(false);
      expect(spawnSyncMock).not.toHaveBeenCalled();
    });
  });

  it('lets the activated CLI assess an installed service even when the loaded updater sees no drift', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'post-update-existing-service-', env: {
      HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux', HAPPIER_DAEMON_SERVICE_CHANNEL: 'stable',
      HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable', HAPPIER_DAEMON_SERVICE_NODE_PATH: process.execPath,
      HAPPIER_DAEMON_SERVICE_ENTRY_PATH: '',
    } }, async ({ homeDir }) => {
      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ mode: 'user' });
      const installed = planDaemonServiceInstall({
        ...runtime, uid: runtime.uid ?? undefined, mode: 'user', targetMode: 'default-following',
      }).files[0]!;
      mkdirSync(dirname(installed.path), { recursive: true });
      writeFileSync(installed.path, installed.content);

      const oldPlan = await resolveBackgroundServiceRepairPlanForCurrentRuntime({
        preferredMode: 'user', includeAllModes: true, systemUser: '',
      });
      expect(oldPlan.plan.actions).toEqual([]);
      expect(oldPlan.plan.manualWarnings).toEqual([]);
      expect(oldPlan.services.some((service) => service.path === installed.path)).toBe(true);

      expect(await maybeRunDoctorRepair({ migrationRan: false, channel: 'stable' })).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
      expect(spawnSyncMock.mock.calls[0]?.[1]).toEqual(['doctor', 'repair']);
    });
  });

  it.each([0, 7])('uses the updated managed CLI and reports a failing repair (exit %s)', async (status) => {
    spawnSyncMock.mockReturnValue({ status });
    await withConfiguredDaemonTestHome({ prefix: 'post-update-repair-', env: {
      HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux', HAPPIER_DAEMON_SERVICE_CHANNEL: 'stable',
      HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable', HAPPIER_DAEMON_SERVICE_NODE_PATH: process.execPath,
    } }, async ({ homeDir }) => {
      const servicePath = join(homeDir, '.config/systemd/user/happier-daemon.default.service');
      mkdirSync(dirname(servicePath), { recursive: true });
      writeFileSync(servicePath, renderSystemdServiceUnit({
        description: 'Happier daemon', execStart: ['/old/happier', 'daemon', 'start-sync'],
        env: { HAPPIER_HOME_DIR: homeDir, HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
          HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following' },
      }));
      const expected = resolveInstalledFirstPartyComponentPaths({
        componentId: 'happier-cli', channel: 'stable', processEnv: process.env,
      }).binaryPath;
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // The activated binary owns repair even if this process has the same version.
      const updated = { migrationRan: false, channel: 'stable' as const };
      expect(await maybeRunDoctorRepair(updated)).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawnSyncMock.mock.calls[0]!;
      // Assert only the owned launch environment so failures never print inherited credentials.
      expect({ command, args, stdio: options?.stdio, env: {
          HAPPIER_HOME_DIR: options?.env?.HAPPIER_HOME_DIR,
          HAPPIER_PUBLIC_RELEASE_CHANNEL: options?.env?.HAPPIER_PUBLIC_RELEASE_CHANNEL,
          HAPPIER_DAEMON_SERVICE_CHANNEL: options?.env?.HAPPIER_DAEMON_SERVICE_CHANNEL,
          HAPPIER_DAEMON_SERVICE_NODE_PATH: options?.env?.HAPPIER_DAEMON_SERVICE_NODE_PATH,
          HAPPIER_DAEMON_SERVICE_ENTRY_PATH: options?.env?.HAPPIER_DAEMON_SERVICE_ENTRY_PATH,
        },
      }).toEqual({ command: expected, args: ['doctor', 'repair'], stdio: 'inherit', env: {
          HAPPIER_HOME_DIR: homeDir, HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
          HAPPIER_DAEMON_SERVICE_CHANNEL: 'stable', HAPPIER_DAEMON_SERVICE_NODE_PATH: expected,
          HAPPIER_DAEMON_SERVICE_ENTRY_PATH: '',
        },
      });
      expect(warn).toHaveBeenCalledTimes(status === 0 ? 0 : 1);
      log.mockRestore();
    });
  });
});
