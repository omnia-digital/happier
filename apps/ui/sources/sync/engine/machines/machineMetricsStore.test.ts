import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMachineMetricsStore, type MachineMetricsLoadResult } from './machineMetricsStore';
import type { MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';

const scope = { serverId: 'server-a', accountId: 'account-a' };
const snapshot = (machineId: string): MachineMetricsSnapshot => ({
    version: 1, machineId, platform: 'linux', sampledAt: 1, collectionMs: 1000,
    cpu: { status: 'available', usagePercent: 33, sampleMs: 1000 },
    memory: { status: 'unavailable', reason: 'collection-failed' }, storage: { status: 'unavailable', reason: 'collection-failed' },
    gpu: { status: 'unavailable', reason: 'no-supported-gpu' }, load: { status: 'available', averages: [1, 2, 3] },
});
afterEach(() => vi.useRealTimers());

describe('machine metrics subscription and polling owner', () => {
    it('refreshes actual online machine targets at 180 seconds, isolates row notifications and retains offline readings', async () => {
        vi.useFakeTimers();
        const calls: string[] = [];
        const store = createMachineMetricsStore({
            load: async (_scope, id) => { calls.push(id); return { status: 'ready', source: 'capability', snapshot: snapshot(id) }; },
            startInterval: (tick, ms) => { const timer = setInterval(tick, ms); return () => clearInterval(timer); },
            isActive: () => true,
        });
        const otherRow = vi.fn();
        const stopOtherRow = store.subscribe(scope, 'other', otherRow);
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }, { machineId: 'windows', online: true }, { machineId: 'offline', online: false }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toEqual(['mac', 'windows']);
        expect(otherRow).not.toHaveBeenCalled();
        expect(store.get(scope, 'offline').status).toBe('offline');
        await vi.advanceTimersByTimeAsync(179_999);
        expect(calls).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toEqual(['mac', 'windows', 'mac', 'windows']);
        stop.release();
        const previous = store.get(scope, 'mac').snapshot;
        const stopOffline = store.retain(scope, [{ machineId: 'mac', online: false }]);
        expect(store.get(scope, 'mac')).toMatchObject({ status: 'offline', snapshot: previous });
        expect(store.get({ ...scope, accountId: 'other-account' }, 'mac').snapshot).toBeNull();
        stopOffline.release(); stopOtherRow();
        await vi.advanceTimersByTimeAsync(180_000);
        expect(calls).toHaveLength(4);
    });

    it('shares an in-flight host read, keeps last-good data on errors, and refreshes on reconnect', async () => {
        let finish!: (value: { status: 'ready'; source: 'capability'; snapshot: MachineMetricsSnapshot }) => void;
        let readCount = 0;
        const store = createMachineMetricsStore({
            load: async () => { readCount++; return await new Promise((resolve) => { finish = resolve; }); },
            startInterval: () => () => undefined, isActive: () => true,
        });
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }]);
        const again = store.refresh(scope, 'mac', true);
        expect(readCount).toBe(1);
        finish({ status: 'ready', source: 'capability', snapshot: snapshot('mac') });
        await again;
        stop.release();
        const stopOffline = store.retain(scope, [{ machineId: 'mac', online: false }]); stopOffline.release();
        const stopReconnected = store.retain(scope, [{ machineId: 'mac', online: true }]);
        expect(readCount).toBe(2);
        finish({ status: 'ready', source: 'capability', snapshot: snapshot('mac') });
        await store.refresh(scope, 'mac', true);
        stopReconnected.release();
    });

    it('reads each host with its platform and records whether the reading came from the CLI capability or the shell', async () => {
        const platforms: Array<string | null | undefined> = [];
        const store = createMachineMetricsStore({
            load: async (_scope, id, platform) => { platforms.push(platform); return { status: 'ready', source: id === 'old' ? 'shell' : 'capability', snapshot: snapshot(id) }; },
            startInterval: () => () => undefined, isActive: () => true,
        });
        const stop = store.retain(scope, [{ machineId: 'old', online: true, platform: 'darwin' }, { machineId: 'new', online: true, platform: 'win32' }]);
        await store.refresh(scope, 'old', true); await store.refresh(scope, 'new', true);
        expect(platforms.slice(0, 2)).toEqual(['darwin', 'win32']);
        expect(store.get(scope, 'old')).toMatchObject({ status: 'ready', source: 'shell' });
        expect(store.get(scope, 'new')).toMatchObject({ status: 'ready', source: 'capability' });
        stop.release();
    });

    it('reads again with the platform once it arrives, instead of joining a read that started without it', async () => {
        const reads: Array<{ platform: string | null | undefined; finish: (result: MachineMetricsLoadResult) => void }> = [];
        const store = createMachineMetricsStore({
            load: (_scope, _id, platform) => new Promise((resolve) => { reads.push({ platform, finish: resolve }); }),
            startInterval: () => () => undefined, isActive: () => true,
        });
        const handle = store.retain(scope, [{ machineId: 'old', online: true, platform: null }]);
        handle.updateTargets([{ machineId: 'old', online: true, platform: 'darwin' }]);
        expect(reads.map((read) => read.platform)).toEqual([null]);
        reads[0].finish({ status: 'unsupported' });
        await vi.waitFor(() => expect(reads.map((read) => read.platform)).toEqual([null, 'darwin']));
        reads[1].finish({ status: 'ready', source: 'shell', snapshot: snapshot('old') });
        await vi.waitFor(() => expect(store.get(scope, 'old')).toMatchObject({ status: 'ready', source: 'shell' }));
        handle.updateTargets([{ machineId: 'old', online: true, platform: 'darwin' }]);
        expect(reads).toHaveLength(2);
        handle.release();
        // A metrics-capable CLI answers without the platform: its late platform must not cost a second read.
        const capable = store.retain(scope, [{ machineId: 'new', online: true, platform: null }]);
        capable.updateTargets([{ machineId: 'new', online: true, platform: 'linux' }]);
        reads[2].finish({ status: 'ready', source: 'capability', snapshot: snapshot('new') });
        await vi.waitFor(() => expect(store.get(scope, 'new')).toMatchObject({ status: 'ready', source: 'capability' }));
        await Promise.resolve(); await Promise.resolve();
        expect(reads).toHaveLength(3);
        capable.release();
    });

    it('shows the last saved reading for its own Home/account machine before any read, and saves each new reading', async () => {
        const saved = new Map<string, unknown>([[JSON.stringify(['server-a', 'account-a', 'mac']), { snapshot: snapshot('mac'), receivedAt: 5, source: 'shell' }]]);
        const persistence = { read: (key: string) => (saved.get(key) ?? null) as never, write: vi.fn((key: string, value: unknown) => { saved.set(key, value); }) };
        const store = createMachineMetricsStore({
            load: async (_scope, id) => ({ status: 'ready', source: 'capability', snapshot: { ...snapshot(id), sampledAt: 9 } }),
            startInterval: () => () => undefined, isActive: () => true, persistence,
        });
        expect(store.get(scope, 'mac')).toMatchObject({ status: 'idle', snapshot: snapshot('mac'), receivedAt: 5, source: 'shell' });
        expect(store.get(scope, 'mac')).toBe(store.get(scope, 'mac'));
        expect(store.get({ ...scope, accountId: 'other-account' }, 'mac').snapshot).toBeNull();
        const stopOffline = store.retain(scope, [{ machineId: 'mac', online: false, platform: 'darwin' }]);
        expect(store.get(scope, 'mac')).toMatchObject({ status: 'offline', snapshot: snapshot('mac'), receivedAt: 5 });
        stopOffline.release();
        expect(persistence.write).not.toHaveBeenCalled();
        await store.refresh(scope, 'mac', true);
        expect(persistence.write).toHaveBeenCalledWith(JSON.stringify(['server-a', 'account-a', 'mac']),
            expect.objectContaining({ snapshot: expect.objectContaining({ sampledAt: 9 }), source: 'capability', receivedAt: expect.any(Number) }));
    });

    it('does no reads while the runtime is inactive', () => {
        let count = 0;
        const store = createMachineMetricsStore({ load: async () => { count++; return { status: 'error' }; }, startInterval: () => () => undefined, isActive: () => false });
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }]);
        expect(count).toBe(0); stop.release();
    });

    it('loads a missing reading on foreground resume without waiting for the first 180-second deadline', async () => {
        let active = false;
        let resume: () => void = () => undefined;
        let count = 0;
        const store = createMachineMetricsStore({
            load: async (_scope, id) => { count++; return { status: 'ready', source: 'capability', snapshot: snapshot(id) }; },
            startInterval: () => () => undefined, isActive: () => active,
            subscribeActiveChange: (listener: () => void) => { resume = listener; return () => undefined; },
        } as Parameters<typeof createMachineMetricsStore>[0]);
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }]);
        expect(count).toBe(0);
        active = true; resume();
        await Promise.resolve(); await Promise.resolve();
        expect(count).toBe(1);
        resume();
        expect(count).toBe(1);
        stop.release();
    });
});
