import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLastCliUpdateResult, runManagedCliUpdate, watchLastCliUpdateResult } from '@happier-dev/cli-common/firstPartyRuntime';

import type { MachineMetadata } from '@/api/types';
import { readCliUpdateFacts } from '@/cli/runtime/update/cliUpdateFacts';

import { createCliUpdateMetadataPublisher } from './cliUpdateMetadataPublisher';
import { initialMachineMetadata } from './metadata';

/**
 * Real temp Happier home with a managed install and the real `last-update.json` writer (a transaction
 * whose release download fails). The OS watch event and relay write are boundaries; the shared
 * cli-common watcher has its own integration test for directory notification after atomic rename.
 */
describe('the daemon republishes its CLI update facts when the update record changes', () => {
  let homeDir = '';
  let execPath = '';
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-update-publish-'));
    const versionDir = join(homeDir, 'cli', 'versions', '1.0.0');
    mkdirSync(versionDir, { recursive: true });
    execPath = join(versionDir, 'happier');
    writeFileSync(execPath, 'binary');
    writeFileSync(join(homeDir, 'cli', 'current.version'), '1.0.0\n');
  });
  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function setup(watchRecord: typeof watchLastCliUpdateResult) {
    const published: MachineMetadata[] = [];
    let serverMetadata: MachineMetadata | null = initialMachineMetadata;
    const publisher = createCliUpdateMetadataPublisher({
      // The machine socket: applies the refresh the way `ApiMachineClient.updateMachineMetadata` does.
      updateMachineMetadata: async (handler) => {
        const next = handler(serverMetadata);
        if (serverMetadata && JSON.stringify(next) === JSON.stringify(serverMetadata)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
        serverMetadata = next;
        published.push(next);
      },
      fallbackMetadata: () => initialMachineMetadata,
      preferredHost: initialMachineMetadata.host,
      readFacts: () => readCliUpdateFacts({
        homeDir,
        publicReleaseRing: 'stable',
        currentVersion: '1.0.0',
        execPath,
        invokedPath: execPath,
        platform: process.platform,
        npmPackageName: '@happier-dev/cli',
      }),
      onError: () => {},
      watchRecord,
    });
    publisher.watch({ channel: 'stable', processEnv: { HAPPIER_HOME_DIR: homeDir } });
    return { publisher, published };
  }

  function setupWithControlledWatch() {
    let notifyRecordChanged: () => void = () => { throw new Error('record watch was not installed'); };
    const state = setup(({ onChange }) => {
      notifyRecordChanged = onChange;
      return () => {};
    });
    return { ...state, notifyRecordChanged: () => notifyRecordChanged() };
  }

  async function recordFailedAttempt(message: string): Promise<void> {
    await runManagedCliUpdate({
      channel: 'stable',
      processEnv: { HAPPIER_HOME_DIR: homeDir },
      preparePayload: async () => { throw new Error(message); },
      readVersion: async () => null,
      restartServiceDaemon: null,
    }).catch(() => undefined);
  }


  it('publishes exactly one refresh carrying the new lastUpdate for one write', async () => {
    const { publisher, published, notifyRecordChanged } = setupWithControlledWatch();
    try {
      await recordFailedAttempt('GitHub returned 503');
      expect(readLastCliUpdateResult({ channel: 'stable', processEnv: { HAPPIER_HOME_DIR: homeDir } })).toMatchObject({ outcome: 'failed', message: expect.stringContaining('GitHub returned 503') });
      notifyRecordChanged();
      await vi.waitFor(() => expect(published).toHaveLength(1));
      // Any further event for the same write reads unchanged facts and publishes nothing.
      notifyRecordChanged();
      expect(published).toHaveLength(1);
      expect(published[0]?.cliUpdate?.lastUpdate).toMatchObject({ outcome: 'failed', message: expect.stringContaining('GitHub returned 503') });
    } finally {
      publisher.stop();
    }
  });

  it('coalesces a burst of record changes during a held publish into one trailing publish of the last record', async () => {
    const heldPublishes: Array<() => void> = [];
    const published: MachineMetadata[] = [];
    let notify: () => void = () => {};
    const facts = { value: 0 };
    const publisher = createCliUpdateMetadataPublisher({
      updateMachineMetadata: async (handler) => {
        await new Promise<void>((release) => { heldPublishes.push(release); });
        published.push(handler(initialMachineMetadata));
      },
      fallbackMetadata: () => initialMachineMetadata,
      preferredHost: initialMachineMetadata.host,
      readFacts: () => ({
        currentVersion: '1.0.0', latestVersion: null, channel: 'stable', installSource: 'managed', updateCommand: 'happier self update',
        canUpdateRemotely: true, lastUpdate: { targetVersion: null, outcome: 'failed', at: facts.value, message: `attempt ${facts.value}` },
      }),
      onError: () => {},
      watchRecord: ({ onChange }) => { notify = onChange; return () => {}; },
    });
    publisher.watch({ channel: 'stable' });

    facts.value = 1;
    notify();
    await vi.waitFor(() => expect(heldPublishes).toHaveLength(1));
    for (const attempt of [2, 3, 4, 5]) {
      facts.value = attempt;
      notify();
    }
    heldPublishes[0]?.();
    await vi.waitFor(() => expect(heldPublishes).toHaveLength(2));
    heldPublishes[1]?.();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(published.map((metadata) => metadata.cliUpdate?.lastUpdate?.message)).toEqual(['attempt 1', 'attempt 5']);
  });

  it('publishes replaced update records and the current record on reconnect', async () => {
    const { publisher, published, notifyRecordChanged } = setupWithControlledWatch();
    try {
      await recordFailedAttempt('first');
      notifyRecordChanged();
      await vi.waitFor(() => expect(published.at(-1)?.cliUpdate?.lastUpdate?.message).toContain('first'));
      await recordFailedAttempt('second');
      notifyRecordChanged();
      await vi.waitFor(() => expect(published.at(-1)?.cliUpdate?.lastUpdate?.message).toContain('second'));

      // The fallback when a watch event is missed: a (re)connect publishes the current record.
      publisher.stop();
      writeFileSync(join(homeDir, 'cli', 'last-update.json'), JSON.stringify({ targetVersion: '2.0.0', outcome: 'succeeded', at: 9, message: null }));
      await publisher.publish();
      expect(published.at(-1)?.cliUpdate?.lastUpdate).toMatchObject({ targetVersion: '2.0.0', outcome: 'succeeded' });
    } finally {
      publisher.stop();
    }
  });

  it('keeps a publish requested while a failing publish is in flight, and runs it after the failure', async () => {
    let calls = 0;
    const published: MachineMetadata[] = [];
    const publisher = createCliUpdateMetadataPublisher({
      updateMachineMetadata: async (handler) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        // The machine socket gave up (its backoff exhausted) on the first publish only.
        if (calls === 1) throw new Error('Machine socket is not connected');
        published.push(handler(initialMachineMetadata));
      },
      fallbackMetadata: () => initialMachineMetadata,
      preferredHost: initialMachineMetadata.host,
      readFacts: () => readCliUpdateFacts({
        homeDir, publicReleaseRing: 'stable', currentVersion: '1.0.0', execPath, invokedPath: execPath,
        platform: process.platform, npmPackageName: '@happier-dev/cli',
      }),
      onError: () => {},
    });

    const first = publisher.publish();
    const reconnect = publisher.publish();
    await Promise.allSettled([first, reconnect]);

    expect(calls).toBe(2);
    expect(published).toHaveLength(1);
    // And the next reconnect still publishes.
    await publisher.publish();
    expect(calls).toBe(3);
  });
});
