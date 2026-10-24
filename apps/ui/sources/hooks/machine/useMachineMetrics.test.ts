import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { useMachineMetricsPolling } from './useMachineMetrics';
import { isHostVisible, isRuntimeActive } from '@/utils/runtime/isRuntimeActive';
import { isTauriDesktop } from '@/utils/platform/tauri';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
afterEach(() => { standardCleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); rpc.mockReset(); });

describe('machine monitor target lifecycle', () => {
    it('pauses collection in a hidden Tauri window, refreshes once when overdue, and releases polling on collapse', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('isTauri', true);
        const visibilityListeners = new Set<() => void>();
        const hostDocument = {
            visibilityState: 'visible',
            addEventListener: (event: string, listener: () => void) => { if (event === 'visibilitychange') visibilityListeners.add(listener); },
            removeEventListener: (event: string, listener: () => void) => { if (event === 'visibilitychange') visibilityListeners.delete(listener); },
        };
        vi.stubGlobal('document', hostDocument);
        const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
        rpc.mockImplementation(async ({ machineId }: { machineId: string }) => ({ ok: true, result: {
            version: 1, machineId, platform: 'darwin', sampledAt: Date.now(), collectionMs: 1000,
            cpu: { status: 'available', usagePercent: 42, sampleMs: 1000 }, memory: absent, storage: absent, gpu: absent, load: absent,
        } }));
        const scope = { serverId: 'tauri-visibility-server', accountId: 'tauri-visibility-account' };
        const hook = await renderHook(() => useMachineMetricsPolling(scope, [{ machineId: 'desktop-host', online: true }]));
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledTimes(1);
        hostDocument.visibilityState = 'hidden';
        visibilityListeners.forEach((listener) => listener());
        expect(isTauriDesktop()).toBe(true);
        expect(isRuntimeActive()).toBe(true); // Desktop background sync remains authorized by the canonical owner.
        expect(isHostVisible()).toBe(false);
        await vi.advanceTimersByTimeAsync(360_000);
        expect(rpc).toHaveBeenCalledTimes(1);
        hostDocument.visibilityState = 'visible';
        visibilityListeners.forEach((listener) => listener());
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledTimes(2);
        visibilityListeners.forEach((listener) => listener());
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledTimes(2);
        await hook.unmount();
        expect(visibilityListeners.size).toBe(0);
        await vi.advanceTimersByTimeAsync(360_000);
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('keeps the healthy host on its original 180-second cadence when another target goes offline', async () => {
        vi.useFakeTimers();
        const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
        rpc.mockImplementation(async ({ machineId }: { machineId: string }) => ({ ok: true, result: {
            version: 1, machineId, platform: 'linux', sampledAt: Date.now(), collectionMs: 1000,
            cpu: { status: 'available', usagePercent: 42, sampleMs: 1000 }, memory: absent, storage: absent, gpu: absent, load: absent,
        } }));
        const scope = { serverId: 'cadence-server', accountId: 'cadence-account' };
        const hook = await renderHook(({ targets }) => useMachineMetricsPolling(scope, targets), { initialProps: {
            targets: [{ machineId: 'healthy-host', online: true }, { machineId: 'changing-host', online: true }],
        } });
        await vi.advanceTimersByTimeAsync(0);
        const healthyCalls = () => rpc.mock.calls.filter(([request]) => request.machineId === 'healthy-host').length;
        expect(healthyCalls()).toBe(1);
        await vi.advanceTimersByTimeAsync(60_000);
        await hook.rerender({ targets: [{ machineId: 'healthy-host', online: true }, { machineId: 'changing-host', online: false }] });
        await vi.advanceTimersByTimeAsync(119_999);
        expect(healthyCalls()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(healthyCalls()).toBe(2);
    });
});
