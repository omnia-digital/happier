import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMachineMetrics } from './machineMetrics';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const scope = { serverId: 'server-a', accountId: 'account-a' };
const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
const reading = (machineId = 'host-a') => ({ version: 1, machineId, platform: 'linux', sampledAt: 1, collectionMs: 1000,
    cpu: { status: 'available', usagePercent: 0, sampleMs: 1000 }, memory: absent, storage: absent, gpu: absent, load: absent });
beforeEach(() => { rpc.mockReset(); });
describe('machine metrics encrypted transport adapter', () => {
    it('pins reads to the receiving Home/account machine and distinguishes a measured zero from unavailable values', async () => {
        rpc.mockResolvedValue({ ok: true, result: reading() });
        const result = await loadMachineMetrics(scope, 'host-a');
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'host-a', serverId: 'server-a', accountId: 'account-a',
            payload: { id: 'tool.machineMetrics', method: 'snapshot', params: { timeoutMs: 30_000 } }, timeoutMs: 30_000 }));
        expect(result).toMatchObject({ status: 'ready', snapshot: { cpu: { status: 'available', usagePercent: 0 }, gpu: { status: 'unavailable' } } });
    });
    it('rejects wrong-machine, out-of-range and malformed telemetry without using it', async () => {
        for (const result of [reading('wrong-host'), { ...reading(), cpu: { status: 'available', usagePercent: 101, sampleMs: 1000 } }, {}]) {
            rpc.mockResolvedValue({ ok: true, result });
            expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'error' });
        }
    });
    it('reports an older CLI capability as unsupported and a broken transport as an error', async () => {
        rpc.mockResolvedValue({ ok: false, error: { code: 'unsupported-capability', message: 'Unsupported capability: tool.machineMetrics' } });
        expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'unsupported' });
        rpc.mockRejectedValue(new Error('disconnected'));
        expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'error' });
    });
});
