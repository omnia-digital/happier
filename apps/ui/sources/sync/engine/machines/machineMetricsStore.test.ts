import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMachineMetricsStore } from './machineMetricsStore';
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
            load: async (_scope, id) => { calls.push(id); return { status: 'ready', snapshot: snapshot(id) }; },
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
        stop();
        const previous = store.get(scope, 'mac').snapshot;
        const stopOffline = store.retain(scope, [{ machineId: 'mac', online: false }]);
        expect(store.get(scope, 'mac')).toMatchObject({ status: 'offline', snapshot: previous });
        expect(store.get({ ...scope, accountId: 'other-account' }, 'mac').snapshot).toBeNull();
        stopOffline(); stopOtherRow();
        await vi.advanceTimersByTimeAsync(180_000);
        expect(calls).toHaveLength(4);
    });

    it('shares an in-flight host read, keeps last-good data on errors, and refreshes on reconnect', async () => {
        let finish!: (value: { status: 'ready'; snapshot: MachineMetricsSnapshot }) => void;
        let readCount = 0;
        const store = createMachineMetricsStore({
            load: async () => { readCount++; return await new Promise((resolve) => { finish = resolve; }); },
            startInterval: () => () => undefined, isActive: () => true,
        });
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }]);
        const again = store.refresh(scope, 'mac', true);
        expect(readCount).toBe(1);
        finish({ status: 'ready', snapshot: snapshot('mac') });
        await again;
        stop();
        const stopOffline = store.retain(scope, [{ machineId: 'mac', online: false }]); stopOffline();
        const stopReconnected = store.retain(scope, [{ machineId: 'mac', online: true }]);
        expect(readCount).toBe(2);
        finish({ status: 'ready', snapshot: snapshot('mac') });
        await store.refresh(scope, 'mac', true);
        stopReconnected();
    });

    it('does no reads while the runtime is inactive', () => {
        let count = 0;
        const store = createMachineMetricsStore({ load: async () => { count++; return { status: 'error' }; }, startInterval: () => () => undefined, isActive: () => false });
        const stop = store.retain(scope, [{ machineId: 'mac', online: true }]);
        expect(count).toBe(0); stop();
    });

    it('loads a missing reading on foreground resume without waiting for the first 180-second deadline', async () => {
        let active = false;
        let resume: () => void = () => undefined;
        let count = 0;
        const store = createMachineMetricsStore({
            load: async (_scope, id) => { count++; return { status: 'ready', snapshot: snapshot(id) }; },
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
        stop();
    });
});
