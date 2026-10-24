import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accountSettingsParse, deriveSettingsSecretsKeyV1, encryptSecretStringV1 } from '@happier-dev/protocol';
import { createTicketReaderCapability } from './toolTicketReader';

const credentials = { token: 'synthetic-account', encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(7) } };
const fixture = resolve('scripts/fixtures/ticketReaderMcpFixture.mjs');
const secret = encryptSecretStringV1('synthetic-read-token', deriveSettingsSecretsKeyV1(credentials.encryption.secret), (length) => new Uint8Array(length).fill(3));
const settings = accountSettingsParse({
  secrets: [{ id: 'ticket-secret', name: 'Fixture', kind: 'apiKey', encryptedValue: { _isSecretValue: true, encryptedValue: secret }, createdAt: 1, updatedAt: 1 }],
  mcpServersSettingsV1: {
    v: 1, strictMode: true,
    servers: [{ id: 'fixture-source', name: 'fixture_linear', title: 'Fixture Linear', transport: 'stdio', stdio: { command: process.execPath, args: [fixture] }, env: { TICKET_FIXTURE_TOKEN: { t: 'savedSecret', secretId: 'ticket-secret' } }, createdAt: 1, updatedAt: 1 }, { id: 'unrelated', name: 'unrelated', transport: 'stdio', stdio: { command: '/unavailable/must-not-launch', args: [] }, env: { MISSING: { t: 'savedSecret', secretId: 'missing-unrelated-secret' } }, createdAt: 1, updatedAt: 1 }],
    bindings: [{ id: 'fixture-binding', serverId: 'fixture-source', enabled: true, target: { t: 'machine', machineId: 'reader-machine' }, createdAt: 1, updatedAt: 1 }, { id: 'unrelated-binding', serverId: 'unrelated', enabled: true, target: { t: 'allMachines' }, createdAt: 1, updatedAt: 1 }],
  },
});
function loader() {
  return vi.fn(async () => ({ source: 'remote' as const, settings, settingsVersion: 1, loadedAtMs: 1, whenRefreshed: null }));
}

describe('opt-in machine ticket reader capability', () => {
  it('reads through a real configured MCP process and encrypted saved-secret materialization, without touching unrelated sources', async () => {
    const loadAccountSettings = loader();
    const capability = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' }, loadAccountSettings });
    const response = await capability.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1' } });
    expect(response).toMatchObject({ ok: true, result: { ticket: { workspaceId: 'fixture', ticketId: 'fixture-issue-id' }, status: { name: 'Q/A - Dev' } } });
    expect(JSON.stringify(response)).not.toContain('synthetic-read-token');
    expect(loadAccountSettings).toHaveBeenCalledWith(expect.objectContaining({ credentials, refresh: 'force' }));
  });

  it('does no credential acquisition or provider work until explicitly enabled and rejects arbitrary invocation input', async () => {
    const loadAccountSettings = loader();
    const disabled = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: {}, loadAccountSettings });
    expect(await disabled.detect({ request: { id: 'tool.ticketReader' }, context: { cliSnapshot: null } })).toEqual({ available: false });
    expect(await disabled.invoke!({ method: 'read', params: {} })).toMatchObject({ ok: false, error: { code: 'disabled' } });
    expect(loadAccountSettings).not.toHaveBeenCalled();
    const enabled = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' }, loadAccountSettings });
    expect(await enabled.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1', toolName: 'save_issue' } })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(loadAccountSettings).not.toHaveBeenCalled();
  });

  it('does not expose another machine binding and stops after a cancellation', async () => {
    const capability = createTicketReaderCapability({ machineId: 'another-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' }, loadAccountSettings: loader() });
    expect(await capability.invoke!({ method: 'sources', params: { directory: '/fixture' } })).toMatchObject({ ok: true, result: { sources: [{ id: 'unrelated' }] } });
    expect(await capability.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1' } })).toMatchObject({ ok: false, error: { code: 'unconfigured' } });
    const controller = new AbortController(); controller.abort();
    expect(await capability.invoke!({ method: 'sources', params: { directory: '/fixture' }, signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });
});
