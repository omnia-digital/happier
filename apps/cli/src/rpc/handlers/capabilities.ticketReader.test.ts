import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { CapabilitiesDetectResponse, CapabilitiesInvokeResponse } from '@/capabilities/types';
import { registerCapabilitiesHandlers } from './capabilities';
import { createEncryptedRpcTestClient } from './encryptedRpc.testkit';

afterEach(() => vi.unstubAllEnvs());

describe('machine-only ticket reader capability over encrypted RPC', () => {
  it('does not give a shared session registrar a ticket reader, even with a forged machine parameter', async () => {
    vi.stubEnv('HAPPIER_TICKET_READER_ENABLED', '1');
    const { call } = createEncryptedRpcTestClient({ scopePrefix: 'session-reader', registerHandlers: (manager) => registerCapabilitiesHandlers(manager) });
    const result = await call<CapabilitiesInvokeResponse, unknown>(RPC_METHODS.CAPABILITIES_INVOKE, { id: 'tool.ticketReader', method: 'sources', params: { machineId: 'another-owner', directory: '/fixture' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-capability' } });
  });

  it('advertises opt-in availability only in the receiving machine account context', async () => {
    vi.stubEnv('HAPPIER_TICKET_READER_ENABLED', '1');
    const { call } = createEncryptedRpcTestClient({ scopePrefix: 'machine-reader', registerHandlers: (manager) => registerCapabilitiesHandlers(manager, { machineCapabilitiesContext: { machineId: 'machine-reader', credentials: { token: 'synthetic-owner', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(4) } } } }) });
    const response = await call<CapabilitiesDetectResponse, unknown>(RPC_METHODS.CAPABILITIES_DETECT, { requests: [{ id: 'tool.ticketReader' }] });
    expect(response.results['tool.ticketReader']).toMatchObject({ ok: true, data: { available: true } });
    const rejected = await call<CapabilitiesInvokeResponse, unknown>(RPC_METHODS.CAPABILITIES_INVOKE, { id: 'tool.ticketReader', method: 'read', params: { toolName: 'save_issue' } });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
});
