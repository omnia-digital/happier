import { describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { CapabilitiesInvokeResponse } from '@/capabilities/types';
import { registerCapabilitiesHandlers } from './capabilities';
import { createEncryptedRpcTestClient } from './encryptedRpc.testkit';

describe('host metrics over the receiving machine encrypted RPC', () => {
    it('collects actual host metrics with the receiver identity, never a caller-supplied identity', async () => {
        const { call } = createEncryptedRpcTestClient({
            scopePrefix: 'metrics-receiver',
            registerHandlers: (manager) => registerCapabilitiesHandlers(manager, {
                machineCapabilitiesContext: { machineId: 'metrics-receiver' },
            } as Parameters<typeof registerCapabilitiesHandlers>[1]),
        });
        const response = await call<CapabilitiesInvokeResponse, unknown>(RPC_METHODS.CAPABILITIES_INVOKE, {
            id: 'tool.machineMetrics', method: 'snapshot', params: { machineId: 'forged' },
        });
        expect(response).toMatchObject({ ok: true, result: {
            machineId: 'metrics-receiver', platform: process.platform,
            cpu: { status: 'available', usagePercent: expect.any(Number), sampleMs: expect.any(Number) },
            memory: { status: 'available', totalBytes: expect.any(Number), usedBytes: expect.any(Number) },
            storage: { status: 'available', filesystemPath: expect.any(String), volume: expect.any(String), totalBytes: expect.any(Number) },
        } });
    });

    it('does not expose host monitoring on shared session handlers', async () => {
        const { call } = createEncryptedRpcTestClient({ scopePrefix: 'session', registerHandlers: registerCapabilitiesHandlers });
        expect(await call(RPC_METHODS.CAPABILITIES_INVOKE, { id: 'tool.machineMetrics', method: 'snapshot' }))
            .toMatchObject({ ok: false, error: { code: 'unsupported-capability' } });
    });
});
