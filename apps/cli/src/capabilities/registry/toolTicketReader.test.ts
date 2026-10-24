import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountSettingsParse, deriveSettingsSecretsKeyV1, encryptSecretStringV1 } from '@happier-dev/protocol';
import { createTicketReaderCapability } from './toolTicketReader';
import { resetInMemoryAccountSettingsContextForTests } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { configuration } from '@/configuration';
import { encodeBase64, encrypt } from '@/api/encryption';

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
describe('opt-in machine ticket reader capability', () => {
  const originalConfiguration = {
    activeServerDir: configuration.activeServerDir, serverUrl: configuration.serverUrl,
    apiServerUrl: configuration.apiServerUrl, publicServerUrl: configuration.publicServerUrl,
    clientEncryptionRequirement: configuration.clientEncryptionRequirement,
  };
  let directory: string;
  beforeEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    directory = await mkdtemp(resolve(tmpdir(), 'happier-ticket-reader-'));
    Object.assign(configuration, { activeServerDir: directory, serverUrl: 'http://127.0.0.1:1', apiServerUrl: 'http://127.0.0.1:1', publicServerUrl: 'http://127.0.0.1:1', clientEncryptionRequirement: 'follow_account' });
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { version: 1, content: { t: 'encrypted', c: encodeBase64(encrypt(credentials.encryption.secret, 'legacy', settings)) } } });
  });
  afterEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    Object.assign(configuration, originalConfiguration);
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('reads through a real configured MCP process and encrypted saved-secret materialization, without touching unrelated sources', async () => {
    const capability = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' } });
    const response = await capability.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1' } });
    expect(response).toMatchObject({ ok: true, result: { ticket: { workspaceId: 'fixture', ticketId: 'fixture-issue-id' }, status: { name: 'Q/A - Dev' } } });
    expect(JSON.stringify(response)).not.toContain('synthetic-read-token');
    expect(axios.get).toHaveBeenCalledWith('http://127.0.0.1:1/v2/account/settings', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-account' }) }));
  });

  it('does no credential acquisition or provider work until explicitly enabled and rejects arbitrary invocation input', async () => {
    const disabled = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: {} });
    expect(await disabled.detect({ request: { id: 'tool.ticketReader' }, context: { cliSnapshot: null } })).toEqual({ available: false });
    expect(await disabled.invoke!({ method: 'read', params: {} })).toMatchObject({ ok: false, error: { code: 'disabled' } });
    expect(axios.get).not.toHaveBeenCalled();
    const enabled = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' } });
    expect(await enabled.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1', toolName: 'save_issue' } })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('does not expose another machine binding and stops after a cancellation', async () => {
    const capability = createTicketReaderCapability({ machineId: 'another-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' } });
    expect(await capability.invoke!({ method: 'sources', params: { directory: '/fixture' } })).toMatchObject({ ok: true, result: { sources: [{ id: 'unrelated' }] } });
    expect(await capability.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1' } })).toMatchObject({ ok: false, error: { code: 'unconfigured' } });
    const controller = new AbortController(); controller.abort();
    expect(await capability.invoke!({ method: 'sources', params: { directory: '/fixture' }, signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('refuses cached connection settings after a failed Home refresh', async () => {
    const capability = createTicketReaderCapability({ machineId: 'reader-machine', credentials }, { env: { HAPPIER_TICKET_READER_ENABLED: '1' } });
    expect(await capability.invoke!({ method: 'sources', params: { directory: '/fixture' } })).toMatchObject({ ok: true });
    vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
    expect(await capability.invoke!({ method: 'read', params: { directory: '/fixture', mcpServerId: 'fixture-source', url: 'https://linear.app/fixture/issue/DEV-1' } })).toMatchObject({ ok: false, error: { code: 'offline' } });
  });
});
