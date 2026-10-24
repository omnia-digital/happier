import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import type { TrackedSession } from '@/daemon/types';
import type { ChildProcess } from 'node:child_process';
import type { Credentials } from '@/persistence';
import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { ApiMachineClient } from '@/api/apiMachine';
import { createOnChildExited } from './onChildExited';
import { readSessionMarkerForPid, writeSessionMarker } from '../sessionRegistry';
import { spawnInlineNodeTestProcess } from '@/testkit/process/spawn';
import { once } from 'node:events';
import { waitForSessionWebhook } from '../spawn/waitForSessionWebhook';
import type { SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';

import { createOnHappySessionWebhook } from './onHappySessionWebhook';

type SessionMarkerWriteFn = NonNullable<Parameters<typeof createOnHappySessionWebhook>[0]['writeSessionMarkerFn']>;
type SessionMarkerWriteArgs = Parameters<SessionMarkerWriteFn>[0];
type SessionMarkerWriteOptions = Parameters<SessionMarkerWriteFn>[1];

function createMetadata(pid: number, startedBy: 'daemon' | 'terminal', rootPath = '/tmp'): Metadata {
  return {
    path: rootPath,
    host: 'test-host',
    homeDir: '/tmp/home',
    happyHomeDir: configuration.happyHomeDir,
    happyLibDir: '/tmp/lib',
    happyToolsDir: '/tmp/tools',
    hostPid: pid,
    startedBy,
    machineId: 'machine-test',
  };
}

function expectSessionMarkerWriteArgs(args: SessionMarkerWriteArgs | null): SessionMarkerWriteArgs {
  expect(args).not.toBeNull();
  if (args === null) {
    throw new Error('expected session marker write args');
  }
  return args;
}

describe('createOnHappySessionWebhook', () => {
  it('preserves and wakes accepted custody installed during an untracked daemon OS admission probe', async () => {
    const sessions = new Map<number, TrackedSession>();
    const awaiters = new Map<number, (session: TrackedSession) => void>();
    const resolvers = new Map<number, (result: SpawnSessionResult) => void>();
    const timeouts = new Map<number, ReturnType<typeof setTimeout>>();
    const tracked: TrackedSession = { pid: process.pid, startedBy: 'daemon' };
    let completion: ReturnType<typeof waitForSessionWebhook> | undefined;
    const originalKill = process.kill.bind(process);
    // Acceptance arrives at the genuine OS liveness boundary. The process run
    // state reader, report correlation and pending waiter remain real.
    const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === process.pid && signal === 0 && !completion) {
        sessions.set(pid, tracked);
        completion = waitForSessionWebhook({ pid, pidToAwaiter: awaiters, pidToSpawnResultResolver: resolvers,
          pidToSpawnWebhookTimeout: timeouts, timeoutErrorMessage: 'Fixture report timeout' });
      }
      return originalKill(pid, signal);
    });
    const report = createOnHappySessionWebhook({
      pidToTrackedSession: sessions, pidToAwaiter: awaiters,
      findHappyProcessByPidFn: async () => null, writeSessionMarkerFn: async () => {},
    });
    try {
      await report('session-admission-arrival', createMetadata(process.pid, 'daemon'));
      expect(sessions.get(process.pid)).toBe(tracked);
      await expect(completion).resolves.toEqual({ type: 'success', sessionId: 'session-admission-arrival' });
    } finally {
      probe.mockRestore();
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      for (const resolve of resolvers.values()) resolve({ type: 'error', errorCode: 'CHILD_EXITED_BEFORE_WEBHOOK', errorMessage: 'Fixture cleanup' });
    }
  });
  it('cannot revive an old wrapper marker when a pre-promotion report census finishes late', async () => {
    const previousHome = configuration.happyHomeDir;
    const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'happier-wrapper-report-marker-'));
    Object.defineProperty(configuration, 'happyHomeDir', { value: fixtureHome });
    const wrapperPid = 813;
    const tracked: TrackedSession = {
      pid: wrapperPid, startedBy: 'daemon', happySessionId: 'session-wrapper-marker',
      // Only the daemon's OS child handle is represented; correlation stays real.
      childProcess: { pid: wrapperPid } as ChildProcess,
    };
    const sessions = new Map([[wrapperPid, tracked]]);
    let releaseCensus!: () => void;
    const census = new Promise<void>((resolve) => { releaseCensus = resolve; });
    let censusEntered = false;
    let wrapperWritten = false;
    const report = createOnHappySessionWebhook({
      pidToTrackedSession: sessions, pidToAwaiter: new Map([[wrapperPid, () => {}]]),
      getParentPidFn: () => wrapperPid,
      findHappyProcessByPidFn: async (pid) => { if (pid === wrapperPid) { censusEntered = true; await census; } return null; },
      writeSessionMarkerFn: async (marker, options) => {
        await writeSessionMarker(marker, options);
        if (marker.pid === wrapperPid) wrapperWritten = true;
      },
    });
    const exit = createOnChildExited({
      pidToTrackedSession: sessions, spawnResourceCleanupByPid: new Map(), sessionAttachCleanupByPid: new Map(),
      getApiMachineForSessions: () => null,
    });
    try {
      await writeSessionMarker({ pid: wrapperPid, startedBy: 'daemon', happySessionId: 'session-wrapper-marker' });
      await report(`PID-${wrapperPid}`, createMetadata(wrapperPid, 'daemon'));
      await vi.waitFor(() => expect(censusEntered).toBe(true));
      await report(`PID-${process.pid}`, createMetadata(process.pid, 'daemon'));
      await exit(wrapperPid, { reason: 'process-exited', code: 0, signal: null });
      expect(sessions.has(process.pid)).toBe(true);
      releaseCensus();
      await vi.waitFor(() => expect(wrapperWritten).toBe(true));
      await vi.waitFor(async () => expect(await readSessionMarkerForPid(wrapperPid)).toBeNull());
    } finally {
      releaseCensus();
      await vi.waitFor(() => expect(wrapperWritten).toBe(true));
      await tracked.reportMarkerCustody?.pending;
      Object.defineProperty(configuration, 'happyHomeDir', { value: previousHome });
      await rm(fixtureHome, { recursive: true, force: true });
    }
  });
  it('rejects a positively dead untracked daemon report without rejecting a live daemon or terminal-origin report', async () => {
    const child = spawnInlineNodeTestProcess('');
    const deadPid = child.pid!;
    await once(child, 'exit');
    const tracked = new Map<number, TrackedSession>();
    const report = createOnHappySessionWebhook({
      pidToTrackedSession: tracked, pidToAwaiter: new Map(),
      findHappyProcessByPidFn: async () => null, writeSessionMarkerFn: async () => {},
    });
    await report('session-dead-daemon', createMetadata(deadPid, 'daemon'));
    expect(tracked.has(deadPid)).toBe(false);
    await report('session-live-daemon', createMetadata(process.pid, 'daemon'));
    expect(tracked.get(process.pid)?.happySessionId).toBe('session-live-daemon');
    await report('session-terminal', createMetadata(deadPid, 'terminal'));
    expect(tracked.get(deadPid)?.happySessionId).toBe('session-terminal');
  });
  it.each([[1, false, 'daemon'], [2, false, 'daemon'], [1, true, 'daemon'], [1, true, 'terminal']] as const)('retires report-marker work before exact-turn exit and cannot revive custody (%s reports, externally classified %s, origin %s)', async (reportCount, externallyClassified, reportOrigin) => {
    const previousHome = configuration.happyHomeDir;
    const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'happier-report-marker-retirement-'));
    Object.defineProperty(configuration, 'happyHomeDir', { value: fixtureHome });
    const pid = 812;
    const tracked: TrackedSession = { pid, startedBy: externallyClassified ? 'happy directly - likely by user from terminal' : 'daemon', happySessionId: 'session-report-marker', activeTurnId: 'turn-report-marker' };
    const trackedSessions = new Map([[pid, tracked]]);
    let releaseCensus!: () => void;
    const census = new Promise<void>((resolve) => { releaseCensus = resolve; });
    let censusCalls = 0;
    let terminalized = false;
    let written = 0;
    let reports: Promise<void>[] = [];
    // The external durable terminal-custody transport is the only API fixture;
    // marker persistence, report correlation and exit staging remain real.
    const terminalCustody = new ApiMachineClient('fixture-token', {
      id: 'machine-test', encryptionKey: new Uint8Array(32).fill(7), encryptionVariant: 'legacy',
      metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0,
    });
    const terminalWrite = vi.spyOn(terminalCustody, 'enqueueDaemonTerminalExactTurnEnd')
      .mockImplementation(async () => { terminalized = true; });
    const report = createOnHappySessionWebhook({
      pidToTrackedSession: trackedSessions, pidToAwaiter: new Map(),
      findHappyProcessByPidFn: async () => { censusCalls += 1; await census; return null; },
      writeSessionMarkerFn: async (...args) => { await writeSessionMarker(...args); written += 1; },
    });
    const exit = createOnChildExited({
      pidToTrackedSession: trackedSessions, spawnResourceCleanupByPid: new Map(), sessionAttachCleanupByPid: new Map(),
      getApiMachineForSessions: () => terminalCustody,
    });
    let exiting: Promise<void> | undefined;
    try {
      await writeSessionMarker({ pid, happySessionId: 'session-report-marker', startedBy: reportOrigin, activeTurnId: 'turn-report-marker' });
      reports = Array.from({ length: reportCount }, () => report('session-report-marker', createMetadata(pid, reportOrigin)));
      await vi.waitFor(() => expect(censusCalls).toBe(reportCount));
      exiting = exit(pid, { reason: 'process-exited', code: 0, signal: null });
      // This external write would retire custody while the independently delayed
      // process census can still produce a late filesystem marker.
      expect(terminalized).toBe(false);
      releaseCensus();
      await Promise.all(reports);
      await exiting;
      await vi.waitFor(() => expect(written).toBe(reportCount));
      expect(terminalized).toBe(true);
      expect(trackedSessions.has(pid)).toBe(false);
      expect(await readSessionMarkerForPid(pid)).toBeNull();
    } finally {
      releaseCensus();
      await Promise.allSettled(reports);
      await exiting;
      await vi.waitFor(() => expect(written).toBe(reportCount));
      terminalWrite.mockRestore();
      await terminalCustody.shutdown();
      Object.defineProperty(configuration, 'happyHomeDir', { value: previousHome });
      await rm(fixtureHome, { recursive: true, force: true });
    }
  });
  it('registers an externally started session when PID is unknown', () => {
    const pidToTrackedSession = new Map<number, TrackedSession>();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('PID-123', createMetadata(123, 'terminal'));

    const tracked = pidToTrackedSession.get(123);
    expect(tracked).toBeDefined();
    expect(tracked?.startedBy).toBe('happy directly - likely by user from terminal');
    expect(tracked?.happySessionId).toBe('PID-123');
  });

  it('updates an already tracked external session when a new session id is reported', () => {
    const pidToTrackedSession = new Map<number, TrackedSession>([
      [
        456,
        {
          pid: 456,
          startedBy: 'happy directly - likely by user from terminal',
          happySessionId: 'PID-456',
        },
      ],
    ]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-real-456', createMetadata(456, 'terminal'));

    expect(pidToTrackedSession.get(456)?.happySessionId).toBe('session-real-456');
  });

  it('updates daemon-spawned session id and resolves spawn awaiter', () => {
    const tracked: TrackedSession = {
      pid: 789,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[789, tracked]]);
    const awaiter = vi.fn();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[789, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-daemon-789', createMetadata(789, 'daemon'));

    expect(pidToTrackedSession.get(789)?.happySessionId).toBe('session-daemon-789');
    expect(awaiter).toHaveBeenCalledTimes(1);
    expect(pidToAwaiter.has(789)).toBe(false);
  });

  it('waits for async spawn finalization before acknowledging the session report', async () => {
    const tracked: TrackedSession = {
      pid: 791,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[791, tracked]]);
    let finishFinalization!: () => void;
    const finalization = new Promise<void>((resolve) => {
      finishFinalization = resolve;
    });
    const awaiter = vi.fn(async () => {
      await finalization;
    });
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[791, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    const report = onWebhook('session-daemon-791', createMetadata(791, 'daemon'));
    let acknowledged = false;
    void report.then(() => {
      acknowledged = true;
    });

    await Promise.resolve();
    expect(acknowledged).toBe(false);

    finishFinalization();
    await report;
    expect(acknowledged).toBe(true);
  });

  it('preserves an established Happier session id when a later webhook reports another identity', async () => {
    const tracked: TrackedSession = {
      pid: 790,
      startedBy: 'daemon',
      happySessionId: 'happier-session-790',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[790, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    await onWebhook('vendor-session-790', createMetadata(790, 'daemon'));

    expect(pidToTrackedSession.get(790)?.happySessionId).toBe('happier-session-790');
  });

  it('matches a Windows Terminal child webhook to the pending daemon launch pid', () => {
    const windowsTerminalPid = 13764;
    const runnerPid = 5500;
    const tracked: TrackedSession = {
      pid: windowsTerminalPid,
      startedBy: 'daemon',
      hostedTerminal: {
        mode: 'windows_terminal',
        requested: 'windows_terminal',
        windows: {
          host: 'windows_terminal',
          pid: windowsTerminalPid,
          windowId: 'happier-qa-claude-unified',
        },
      },
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[windowsTerminalPid, tracked]]);
    const awaiter = vi.fn();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[windowsTerminalPid, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-windows-terminal-1', {
      ...createMetadata(runnerPid, 'daemon'),
      terminal: {
        mode: 'windows_terminal',
        requested: 'windows_terminal',
        windows: {
          host: 'windows_terminal',
          windowId: 'happier-qa-claude-unified',
        },
      },
    });

    expect(awaiter).toHaveBeenCalledTimes(1);
    expect(awaiter).toHaveBeenCalledWith(expect.objectContaining({
      pid: windowsTerminalPid,
      sessionRunnerPid: runnerPid,
      happySessionId: 'session-windows-terminal-1',
    }));
    expect(pidToAwaiter.has(windowsTerminalPid)).toBe(false);
    expect(pidToTrackedSession.has(runnerPid)).toBe(false);
    expect(pidToTrackedSession.get(windowsTerminalPid)?.sessionRunnerPid).toBe(runnerPid);
    expect(pidToTrackedSession.get(windowsTerminalPid)?.happySessionId).toBe('session-windows-terminal-1');
  });

  it('matches concurrent Windows Terminal child webhooks by unique tab title inside a shared window', () => {
    const firstWindowsTerminalPid = 13764;
    const secondWindowsTerminalPid = 13765;
    const runnerPid = 5501;
    const firstAwaiter = vi.fn();
    const secondAwaiter = vi.fn();
    const firstTracked: TrackedSession = {
      pid: firstWindowsTerminalPid,
      startedBy: 'daemon',
      hostedTerminal: {
        mode: 'windows_terminal',
        requested: 'windows_terminal',
        windows: {
          host: 'windows_terminal',
          pid: firstWindowsTerminalPid,
          windowId: 'happier-qa-claude-unified',
          title: 'Happier claude spawn-a',
        },
      },
    };
    const secondTracked: TrackedSession = {
      pid: secondWindowsTerminalPid,
      startedBy: 'daemon',
      hostedTerminal: {
        mode: 'windows_terminal',
        requested: 'windows_terminal',
        windows: {
          host: 'windows_terminal',
          pid: secondWindowsTerminalPid,
          windowId: 'happier-qa-claude-unified',
          title: 'Happier claude spawn-b',
        },
      },
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([
      [firstWindowsTerminalPid, firstTracked],
      [secondWindowsTerminalPid, secondTracked],
    ]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([
      [firstWindowsTerminalPid, firstAwaiter],
      [secondWindowsTerminalPid, secondAwaiter],
    ]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-windows-terminal-2', {
      ...createMetadata(runnerPid, 'daemon'),
      terminal: {
        mode: 'windows_terminal',
        requested: 'windows_terminal',
        windows: {
          host: 'windows_terminal',
          windowId: 'happier-qa-claude-unified',
          title: 'Happier claude spawn-b',
        },
      },
    });

    expect(firstAwaiter).not.toHaveBeenCalled();
    expect(secondAwaiter).toHaveBeenCalledTimes(1);
    expect(secondAwaiter).toHaveBeenCalledWith(expect.objectContaining({
      pid: secondWindowsTerminalPid,
      sessionRunnerPid: runnerPid,
      happySessionId: 'session-windows-terminal-2',
    }));
    expect(pidToAwaiter.has(firstWindowsTerminalPid)).toBe(true);
    expect(pidToAwaiter.has(secondWindowsTerminalPid)).toBe(false);
    expect(pidToTrackedSession.has(runnerPid)).toBe(false);
    expect(pidToTrackedSession.get(secondWindowsTerminalPid)?.sessionRunnerPid).toBe(runnerPid);
  });

  it('notifies when a tracked daemon session reports provider context', () => {
    const tracked: TrackedSession = {
      pid: 790,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[790, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();
    const onTrackedSessionReported = vi.fn();

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
      onTrackedSessionReported,
    });

    onWebhook('session-daemon-790', createMetadata(790, 'daemon'));

    expect(onTrackedSessionReported).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'session-daemon-790',
      pid: 790,
    }));
  });

  it('passes a server-created witness only for a correlated daemon child', async () => {
    const tracked: TrackedSession = { pid: 790, startedBy: 'daemon' };
    const onTrackedSessionCreationReported = vi.fn();
    const report = createOnHappySessionWebhook({
      pidToTrackedSession: new Map([[790, tracked]]),
      pidToAwaiter: new Map(),
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
      onTrackedSessionCreationReported,
    });
    await report('session-created', createMetadata(790, 'daemon'), 'created');
    expect(onTrackedSessionCreationReported).toHaveBeenCalledWith(tracked, expect.objectContaining({
      sessionId: 'session-created', serverResolution: 'created',
    }));
    await report('session-forged', createMetadata(791, 'terminal'), 'created');
    expect(onTrackedSessionCreationReported).toHaveBeenCalledTimes(1);
  });

  it('notifies when a terminal-started session reports provider context', () => {
    const onTrackedSessionReported = vi.fn();
    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession: new Map<number, TrackedSession>(),
      pidToAwaiter: new Map<number, (session: TrackedSession) => void>(),
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
      onTrackedSessionReported,
    });

    onWebhook('session-terminal-793', {
      ...createMetadata(793, 'terminal'),
      flavor: 'opencode',
      connectedServices: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'profile',
            profileId: 'work',
          },
        },
      },
      connectedServiceBrokerSelectionIdentityV1:
        'opencode|connected|broker:1|openai-codex:work:acct-1',
    } as Metadata);

    expect(onTrackedSessionReported).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'session-terminal-793',
      pid: 793,
      startedBy: 'happy directly - likely by user from terminal',
    }));
  });

  it('does not acknowledge daemon readiness until the strict tracked-session callback settles', async () => {
    const tracked: TrackedSession = { pid: 792, startedBy: 'daemon' };
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    const onTrackedSessionReported = vi.fn();
    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession: new Map<number, TrackedSession>([[792, tracked]]),
      pidToAwaiter: new Map<number, (session: TrackedSession) => void>(),
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
      onTrackedSessionReady: async () => await ready,
      onTrackedSessionReported,
    });

    let acknowledged = false;
    const report = Promise.resolve(onWebhook('session-daemon-792', createMetadata(792, 'daemon')))
      .then(() => { acknowledged = true; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(onTrackedSessionReported).toHaveBeenCalledWith(expect.objectContaining({
      happySessionId: 'session-daemon-792',
      pid: 792,
    }));
    releaseReady();
    await report;
    expect(acknowledged).toBe(true);
  });

  it('does not fail session registration when a best-effort tracked-session observer throws synchronously', () => {
    const tracked: TrackedSession = {
      pid: 791,
      startedBy: 'daemon',
    };
    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession: new Map<number, TrackedSession>([[791, tracked]]),
      pidToAwaiter: new Map<number, (session: TrackedSession) => void>(),
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
      onTrackedSessionReported: () => {
        throw new ReferenceError('optional observer is unavailable');
      },
    });

    expect(() => onWebhook('session-daemon-791', createMetadata(791, 'daemon'))).not.toThrow();
    expect(tracked.happySessionId).toBe('session-daemon-791');
  });

  it('stores vendorResumeId from session metadata when available', () => {
    const tracked: TrackedSession = {
      pid: 444,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[444, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-daemon-444', {
      ...createMetadata(444, 'daemon'),
      flavor: 'codex',
      codexSessionId: 'vendor-session-444',
    });

    expect(pidToTrackedSession.get(444)?.vendorResumeId).toBe('vendor-session-444');
  });

  it('does not preserve stale connected-service restart intent when refreshing a daemon marker from webhook metadata', async () => {
    const tracked: TrackedSession = {
      pid: 445,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[445, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerOptions: SessionMarkerWriteOptions | undefined;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (_args, options) => {
        markerOptions = options;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-445', {
      ...createMetadata(445, 'daemon'),
      flavor: 'codex',
      codexSessionId: 'vendor-session-445',
    });
    await markerWritten;

    expect(markerOptions).toBeUndefined();
  });

  it('does not preserve stale connected-service restart intent through routine marker refreshes', async () => {
    const tracked: TrackedSession = {
      pid: 446,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[446, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerOptions: SessionMarkerWriteOptions | undefined;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (_args, options) => {
        markerOptions = options;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-446', {
      ...createMetadata(446, 'daemon'),
      flavor: 'codex',
      codexSessionId: 'vendor-session-446',
    });
    await markerWritten;

    expect(markerOptions).toBeUndefined();
  });

  it('does not resolve daemon awaiter on PID placeholder and resolves on canonical id', () => {
    const tracked: TrackedSession = {
      pid: 9001,
      startedBy: 'daemon',
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[9001, tracked]]);
    const awaiter = vi.fn();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[9001, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('PID-9001', createMetadata(9001, 'daemon'));

    expect(awaiter).toHaveBeenCalledTimes(0);
    expect(pidToAwaiter.has(9001)).toBe(true);
    expect(pidToTrackedSession.get(9001)?.happySessionId).toBe('PID-9001');

    onWebhook('session-real-9001', createMetadata(9001, 'daemon'));

    expect(awaiter).toHaveBeenCalledTimes(1);
    expect(pidToAwaiter.has(9001)).toBe(false);
    expect(pidToTrackedSession.get(9001)?.happySessionId).toBe('session-real-9001');
  });

  it('expands tilde paths before writing the session marker', async () => {
    const pidToTrackedSession = new Map<number, TrackedSession>();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('PID-321', createMetadata(321, 'terminal', '~/Documents/Development/happier/dev'));
    await markerWritten;

    const expected = path.join(os.homedir(), 'Documents', 'Development', 'happier', 'dev');
    const marker = expectSessionMarkerWriteArgs(markerArgs);
    expect(marker.cwd).toBe(expected);
    expect(marker.metadata.path).toBe(expected);
  });

  it('includes a safe respawn descriptor for daemon-spawned sessions with spawnOptions', async () => {
    const credentials: Credentials = {
      token: 't',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(5) },
    };
    const spawnOptionsWithLegacySecret = {
      directory: '/tmp/workspace',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      transcriptStorage: 'direct',
      token: 'secret-token-should-not-be-persisted',
      pendingFirstInput: { text: 'secret prompt should not be persisted', localId: 'spawn-first:nonce' },
      resume: 'vendor-resume-id',
      environmentVariables: {
        CLAUDE_CONFIG_DIR: '/tmp/claude-config',
        CODEX_HOME: '/tmp/codex-home',
        ANTHROPIC_AUTH_TOKEN: 'secret-provider-token',
        OPENAI_API_KEY: 'secret-openai-key',
        FOO: 'bar',
      },
      terminal: {
        mode: 'tmux',
        tmux: { sessionName: 'happy', isolated: true, tmpDir: '/tmp/tmux' },
      },
    } satisfies SpawnSessionOptions & { token: string };
    const tracked: TrackedSession = {
      pid: 555,
      startedBy: 'daemon',
      spawnOptions: spawnOptionsWithLegacySecret,
    };

    const pidToTrackedSession = new Map<number, TrackedSession>([[555, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      readCredentialsFn: async () => credentials,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-555', createMetadata(555, 'daemon', '/tmp/workspace'));
    await markerWritten;

    const marker = expectSessionMarkerWriteArgs(markerArgs);
    expect(marker.respawn).toEqual({
      version: 1,
      directory: '/tmp/workspace',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      resume: 'vendor-resume-id',
      terminal: {
        mode: 'tmux',
        tmux: { sessionName: 'happy', isolated: true, tmpDir: '/tmp/tmux' },
      },
      transcriptStorage: 'direct',
      environmentVariables: {
        CLAUDE_CONFIG_DIR: '/tmp/claude-config',
        CODEX_HOME: '/tmp/codex-home',
      },
      sealedEnvironmentVariables: {
        format: 'account_scoped_v1',
        ciphertext: expect.any(String),
      },
    });
    expect(marker.respawn?.token).toBeUndefined();
    expect(marker.respawn?.environmentVariables).not.toMatchObject({
      ANTHROPIC_AUTH_TOKEN: expect.any(String),
      OPENAI_API_KEY: expect.any(String),
      FOO: expect.any(String),
    });
    expect(marker.respawn?.pendingFirstInput).toBeUndefined();
  });

  it('persists the learned vendorResumeId into the respawn descriptor for fresh daemon sessions started without --resume', async () => {
    const tracked: TrackedSession = {
      pid: 557,
      startedBy: 'daemon',
      spawnOptions: {
        directory: '/tmp/workspace',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      } satisfies SpawnSessionOptions,
    };

    const pidToTrackedSession = new Map<number, TrackedSession>([[557, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-557', {
      ...createMetadata(557, 'daemon', '/tmp/workspace'),
      flavor: 'codex',
      codexSessionId: 'vendor-session-557',
    });
    await markerWritten;

    expect(pidToTrackedSession.get(557)?.vendorResumeId).toBe('vendor-session-557');
    const marker = expectSessionMarkerWriteArgs(markerArgs);
    expect(marker.respawn?.vendorResumeId).toBe('vendor-session-557');
  });

  it('persists the exact configured ACP provider session id into tracked state and the respawn marker', async () => {
    const tracked: TrackedSession = {
      pid: 558,
      startedBy: 'daemon',
      spawnOptions: {
        directory: '/tmp/workspace',
        backendTarget: { kind: 'configuredAcpBackend', backendId: 'custom-backend' },
      },
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[558, tracked]]);
    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => { resolveMarker = resolve; });
    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter: new Map(),
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-558', {
      ...createMetadata(558, 'daemon', '/tmp/workspace'),
      flavor: 'acp:misleading-flavor',
      acpConfiguredBackendV1: {
        v: 1,
        updatedAt: 1,
        backendId: 'custom-backend',
        title: 'Custom backend',
      },
      customAcpSessionId: 'configured-session-558',
    } as unknown as Metadata);
    await markerWritten;

    expect(tracked.vendorResumeId).toBe('configured-session-558');
    expect(expectSessionMarkerWriteArgs(markerArgs).respawn?.vendorResumeId).toBe('configured-session-558');
  });

  it('clears a stale configured ACP provider session id when exact metadata mismatches the tracked target', async () => {
    const tracked: TrackedSession = {
      pid: 559,
      startedBy: 'daemon',
      vendorResumeId: 'stale-configured-session',
      spawnOptions: {
        directory: '/tmp/workspace',
        backendTarget: { kind: 'configuredAcpBackend', backendId: 'custom-backend' },
      },
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[559, tracked]]);
    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => { resolveMarker = resolve; });
    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter: new Map(),
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-559', {
      ...createMetadata(559, 'daemon', '/tmp/workspace'),
      flavor: 'acp:custom-backend',
      acpConfiguredBackendV1: {
        v: 1,
        updatedAt: 1,
        backendId: 'other-backend',
        title: 'Other backend',
      },
      customAcpSessionId: 'other-session-559',
    } as unknown as Metadata);
    await markerWritten;

    expect(tracked.vendorResumeId).toBeUndefined();
    expect(expectSessionMarkerWriteArgs(markerArgs).respawn?.vendorResumeId).toBeUndefined();
  });

  it('matches an unknown webhook PID to a daemon-tracked wrapper PID via PPID and resolves awaiter', () => {
    const wrapperPid = 111;
    const runnerPid = 222;
    const tracked: TrackedSession = { pid: wrapperPid, startedBy: 'daemon' };
    const pidToTrackedSession = new Map<number, TrackedSession>([[wrapperPid, tracked]]);
    const awaiter = vi.fn();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[wrapperPid, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => wrapperPid,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook('session-real-222', createMetadata(runnerPid, 'daemon'));

    expect(awaiter).toHaveBeenCalledTimes(1);
    expect(pidToAwaiter.has(wrapperPid)).toBe(false);
    expect(pidToTrackedSession.has(runnerPid)).toBe(false);
    expect(pidToTrackedSession.get(wrapperPid)?.happySessionId).toBe('session-real-222');
    expect(pidToTrackedSession.get(wrapperPid)?.sessionRunnerPid).toBe(runnerPid);
  });

  it('defers wrapper awaiter resolution on PID placeholder and resolves on canonical id', () => {
    const wrapperPid = 111;
    const runnerPid = 222;
    const tracked: TrackedSession = { pid: wrapperPid, startedBy: 'daemon' };
    const pidToTrackedSession = new Map<number, TrackedSession>([[wrapperPid, tracked]]);
    const awaiter = vi.fn();
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>([[wrapperPid, awaiter]]);

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => wrapperPid,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async () => {},
    });

    onWebhook(`PID-${runnerPid}`, createMetadata(runnerPid, 'daemon'));

    expect(awaiter).toHaveBeenCalledTimes(0);
    expect(pidToAwaiter.has(wrapperPid)).toBe(true);

    onWebhook('session-real-222', createMetadata(runnerPid, 'daemon'));

    expect(awaiter).toHaveBeenCalledTimes(1);
    expect(pidToAwaiter.has(wrapperPid)).toBe(false);
  });

  it('falls back to daemon child spawn arguments when process discovery cannot resolve command identity', async () => {
    const sessionPid = 777;
    const spawnArgs = [
      '/usr/bin/node',
      '/repo/.project/tmp/cli-dist-snapshot/src/index.ts',
      'claude',
      '--happy-starting-mode',
      'remote',
      '--started-by',
      'daemon',
    ];
    const tracked: TrackedSession = {
      pid: sessionPid,
      startedBy: 'daemon',
      childProcess: { pid: sessionPid, spawnargs: spawnArgs } as Pick<ChildProcess, 'pid' | 'spawnargs'> as ChildProcess,
    };
    const pidToTrackedSession = new Map<number, TrackedSession>([[sessionPid, tracked]]);
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    let markerArgs: SessionMarkerWriteArgs | null = null;
    let resolveMarker!: () => void;
    const markerWritten = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });

    const onWebhook = createOnHappySessionWebhook({
      pidToTrackedSession,
      pidToAwaiter,
      getParentPidFn: () => null,
      findHappyProcessByPidFn: async () => null,
      writeSessionMarkerFn: async (args) => {
        markerArgs = args;
        resolveMarker();
      },
    });

    onWebhook('session-daemon-777', createMetadata(sessionPid, 'daemon', '/tmp/workspace'));
    await markerWritten;

    const expectedCommand = spawnArgs.join(' ');
    const marker = expectSessionMarkerWriteArgs(markerArgs);
    expect(marker.processCommand).toBe(expectedCommand);
    expect(marker.processCommandHash).toBeDefined();
    expect(pidToTrackedSession.get(sessionPid)?.processCommand).toBe(expectedCommand);
    expect(pidToTrackedSession.get(sessionPid)?.processCommandHash).toBe(marker.processCommandHash);
  });
});
