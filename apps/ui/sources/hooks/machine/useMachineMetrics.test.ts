import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { useMachineMetricsPolling } from './useMachineMetrics';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
afterEach(() => { standardCleanup(); vi.useRealTimers(); rpc.mockReset(); });

describe('machine monitor target lifecycle', () => {
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
