import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { configuration } from '@/configuration';
import { spawnSleepyDetachedProcess, withConfiguredDaemonTestHome } from './testkit/fakeDaemonLifecycle.testkit';

const probe = vi.hoisted(() => ({ deniedPid: 0 }));

// Process command-line reads are OS boundaries. Keep the lifecycle classifier real
// while reproducing an owner whose process presence is visible but identity is unreadable.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]) === `/proc/${probe.deniedPid}/cmdline`) {
        throw Object.assign(new Error('command line unavailable'), { code: 'EACCES' });
      }
      return actual.readFile(...args);
    },
  };
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: Parameters<typeof actual.execFile>) => {
      if (probe.deniedPid && args[0] === 'ps' && args[1]?.includes('-Aww')) {
        throw Object.assign(new Error('process inventory unavailable'), { code: 'EACCES' });
      }
      return actual.execFile(...args);
    },
    execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
      if ((args[0] === 'ps' || args[0] === 'powershell.exe') && args[1]?.some((arg) => arg.includes(String(probe.deniedPid)))) {
        throw Object.assign(new Error('process inventory unavailable'), { code: 'EACCES' });
      }
      return actual.execFileSync(...args);
    },
  };
});

vi.mock('ps-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ps-list')>();
  return {
    ...actual,
    default: async (): Promise<Awaited<ReturnType<typeof actual.default>>> => {
      throw Object.assign(new Error('process inventory unavailable'), { code: 'EACCES' });
    },
  };
});

let doctor: typeof import('./doctor');
let controlClient: typeof import('./controlClient');
let multiDaemon: typeof import('./multiDaemon');

beforeAll(async () => {
  // Load the real dependency graph before the process-lifecycle assertion budget.
  [doctor, controlClient, multiDaemon] = await Promise.all([
    import('./doctor'), import('./controlClient'), import('./multiDaemon'),
  ]);
}, 300_000);

describe('unverified daemon startup ownership', () => {
  it('keeps stale unknown ownership fail-closed for stop-all while status keeps its stale-ignore policy', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'daemon-stale-unverified-' }, async ({ homeDir }) => {
      const child = spawnSleepyDetachedProcess(['/repo/dist/index.mjs', 'daemon', 'start-sync']);
      probe.deniedPid = child.pid;
      const lockPath = join(homeDir, 'servers', configuration.activeServerId, 'daemon.state.json.lock');
      try {
        mkdirSync(dirname(lockPath), { recursive: true });
        writeFileSync(lockPath, String(child.pid));
        const stale = new Date(Date.now() - 10 * 60_000);
        utimesSync(lockPath, stale, stale);
        const { classifyDaemonLifecycleProcessByPid } = doctor;
        expect(await classifyDaemonLifecycleProcessByPid(child.pid)).toEqual({ kind: 'unknown' });
        const { inspectDaemonRunningStateAndCleanupStaleState, stopDaemon } = controlClient;
        expect(await inspectDaemonRunningStateAndCleanupStaleState()).toEqual({ status: 'not-running' });
        await expect(stopDaemon()).rejects.toMatchObject({ code: 'daemon_stop_incomplete', reason: 'process_identity_unverified', pid: child.pid });
        const { stopAllDaemonsBestEffort } = multiDaemon;
        await expect(stopAllDaemonsBestEffort()).rejects.toMatchObject({ code: 'daemon_stop_incomplete', reason: 'process_identity_unverified', pid: child.pid });
        expect(process.kill(child.pid, 0)).toBe(true);
      } finally {
        probe.deniedPid = 0;
        await child.kill();
      }
    });
  });
});
