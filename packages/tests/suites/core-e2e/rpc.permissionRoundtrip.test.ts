import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { accountSettingsParse } from '@happier-dev/protocol';
import type { AgentState } from '@/api/types';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { createSession, createSessionWithCiphertexts, fetchSessionV2 } from '../../src/testkit/sessions';
import { createUserScopedSocketCollector } from '../../src/testkit/socketClient';
import { FailureArtifacts } from '../../src/testkit/failureArtifacts';
import { envFlag } from '../../src/testkit/env';
import { writeTestManifestForServer } from '../../src/testkit/manifestForServer';
import { waitFor } from '../../src/testkit/timing';
import { createMachineBoundSessionScopedSocketCollector } from '../../src/testkit/sessionSocketBinding';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: rpc permission round-trip + reconnect', () => {
  let server: StartedServer | null = null;

  afterAll(async () => {
    await server?.stop();
  });

  it('publishes a real CLI occurrence before push and admits only its matching authenticated response', async () => {
    const testDir = run.testDir('rpc-permission-occurrence-cli-source');
    const relay = await startServerLight({ testDir });
    vi.stubEnv('HAPPIER_HOME_DIR', join(testDir, 'cli-home'));
    vi.stubEnv('HAPPIER_SERVER_URL', relay.baseUrl);
    vi.stubEnv('HAPPIER_PUBLIC_SERVER_URL', relay.baseUrl);
    vi.stubEnv('HAPPIER_LOCAL_SERVER_URL', relay.baseUrl);
    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
    const { ApiSessionClient } = await import('@/api/session/sessionClient');
    const { CodexLikePermissionHandler } = await import('@/agent/permissions/CodexLikePermissionHandler');
    const { createTestMetadata } = await import('@/testkit/backends/sessionMetadata');
    const { encrypt, decrypt, encodeBase64, decodeBase64 } = await import('@/api/encryption');
    const auth = await createTestAuth(relay.baseUrl);
    const key = randomBytes(32);
    const machineId = randomUUID();
    const metadata = createTestMetadata({ machineId, path: testDir, homeDir: testDir });
    const { sessionId } = await createSessionWithCiphertexts({
      baseUrl: relay.baseUrl, token: auth.token,
      metadataCiphertextBase64: encodeBase64(encrypt(key, 'legacy', metadata)),
    });
    const binding = await createMachineBoundSessionScopedSocketCollector({
      baseUrl: relay.baseUrl, token: auth.token, sessionId, machineId,
    });
    binding.socket.close();
    const snapshot = await fetchSessionV2(relay.baseUrl, auth.token, sessionId);
    const client = new ApiSessionClient(auth.token, {
      id: sessionId, seq: snapshot.seq, metadata, metadataVersion: snapshot.metadataVersion,
      agentState: null, agentStateVersion: snapshot.agentStateVersion,
      encryptionMode: 'e2ee', encryptionKey: key, encryptionVariant: 'legacy',
    });
    const ui = createUserScopedSocketCollector(relay.baseUrl, auth.token);
    const outsiderAuth = await createTestAuth(relay.baseUrl);
    const outsider = createUserScopedSocketCollector(relay.baseUrl, outsiderAuth.token);
    const pushes: Array<{ data: Record<string, unknown>; stored: AgentState | null }> = [];
    // Only the external push transport is replaced. Session publication, locking,
    // encryption, RPC registration, permission policy and relay are real source.
    const handler = new CodexLikePermissionHandler({
      session: client, logPrefix: '[OccurrenceE2E]',
      getAccountSettings: () => accountSettingsParse({
        notificationsSettingsV1: { v: 1, pushEnabled: true, permissionRequest: true },
      }),
      pushSender: { sendToAllDevicesAsync: async (_title, _body, data) => {
        const row = await fetchSessionV2(relay.baseUrl, auth.token, sessionId);
        pushes.push({ data, stored: row.agentState ? decrypt(key, 'legacy', decodeBase64(row.agentState)) : null });
      } },
    });
    const method = `${sessionId}:session.permission.respondToOccurrence.v1`;
    const call = async (payload: Record<string, unknown>, rpcMethod = method) => {
      const response = await ui.rpcCall<{ ok: boolean; result?: string; errorCode?: string }>(
        rpcMethod, encodeBase64(encrypt(key, 'legacy', payload)),
      );
      expect(response.ok, JSON.stringify(response)).toBe(true);
      expect(response.result).toEqual(expect.any(String));
      return decrypt(key, 'legacy', decodeBase64(response.result!)) as { ok: boolean; errorCode?: string };
    };
    try {
      ui.connect();
      outsider.connect();
      await waitFor(() => ui.isConnected() && outsider.isConnected());
      const decision = handler.handleToolCall('reused', 'Write', { path: '/test/first' });
      await waitFor(() => pushes.length === 1, { context: 'CLI occurrence publication and push' });
      const occurrence = pushes[0].data.occurrenceId;
      expect(occurrence).toEqual(expect.any(String));
      expect(pushes[0].stored?.requests?.reused?.occurrenceId).toBe(occurrence);

      const rejectedAccount = await outsider.rpcCall<{ ok: boolean }>(method,
        encodeBase64(encrypt(key, 'legacy', { id: 'reused', occurrenceId: occurrence, approved: true })));
      expect(rejectedAccount.ok).toBe(false);
      expect(await call({ id: 'reused', occurrenceId: 'wrong-occurrence', approved: true })).toMatchObject({ ok: false });
      expect(client.getAgentStateSnapshot()?.requests?.reused?.occurrenceId).toBe(occurrence);
      expect(await call({ id: 'reused', occurrenceId: occurrence, approved: true })).toEqual({ ok: true });
      await expect(decision).resolves.toMatchObject({ decision: 'approved' });
      expect(await call({ id: 'reused', occurrenceId: occurrence, approved: true })).toMatchObject({ ok: false });

      handler.reset();
      const replacement = handler.handleToolCall('reused', 'Write', { path: '/test/second' });
      await waitFor(() => pushes.length === 2, { context: 'replacement occurrence' });
      const nextOccurrence = pushes[1].data.occurrenceId;
      expect(nextOccurrence).not.toBe(occurrence);
      expect(await call({ id: 'reused', occurrenceId: occurrence, approved: false })).toMatchObject({ ok: false });
      expect(client.getAgentStateSnapshot()?.requests?.reused?.occurrenceId).toBe(nextOccurrence);
      // Released in-app clients intentionally retain the request-ID-only ABI.
      expect(await call({ id: 'reused', approved: false, decision: 'denied' }, `${sessionId}:permission`)).toEqual({ ok: true });
      await expect(replacement).resolves.toMatchObject({ decision: 'denied' });
      const finalRow = await fetchSessionV2(relay.baseUrl, auth.token, sessionId);
      const finalState = decrypt(key, 'legacy', decodeBase64(finalRow.agentState!)) as AgentState;
      expect(finalState.requests?.reused).toBeUndefined();
      expect(finalState.completedRequests?.reused?.occurrenceId).toBe(nextOccurrence);
      expect(finalState.completedRequests?.reused?.status).toBe('denied');
    } finally {
      handler.reset();
      ui.close();
      outsider.close();
      await client.close();
      await relay.stop();
      vi.unstubAllEnvs();
    }
  }, 120_000);

  it('routes rpc-call to a different socket; fails closed while agent disconnected; works again after reconnect', async () => {
    const testDir = run.testDir('rpc-permission-roundtrip');
    const saveArtifactsOnSuccess = envFlag(['HAPPIER_E2E_SAVE_ARTIFACTS', 'HAPPY_E2E_SAVE_ARTIFACTS'], false);
    const startedAt = new Date().toISOString();
    server = await startServerLight({ testDir });
    const auth = await createTestAuth(server.baseUrl);
    const { sessionId } = await createSession(server.baseUrl, auth.token);

    const ui = createUserScopedSocketCollector(server.baseUrl, auth.token);
    const { socket: agent } = await createMachineBoundSessionScopedSocketCollector({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
    });

    const artifacts = new FailureArtifacts();
    artifacts.json('ui.events.json', () => ui.getEvents());
    artifacts.json('agent.events.json', () => agent.getEvents());
    const payloads: Array<{ method: string; params: string }> = [];
    artifacts.json('agent.rpc.payloads.json', () => payloads);

    let passed = false;
    writeTestManifestForServer({
      testDir,
      server,
      startedAt,
      runId: run.runId,
      testName: 'rpc-permission-roundtrip',
      sessionIds: [sessionId],
      env: {
        CI: process.env.CI,
        HAPPIER_E2E_SAVE_ARTIFACTS: process.env.HAPPIER_E2E_SAVE_ARTIFACTS ?? process.env.HAPPY_E2E_SAVE_ARTIFACTS,
      },
    });

    ui.connect();
    agent.connect();
    await waitFor(() => ui.isConnected() && agent.isConnected(), { timeoutMs: 20_000 });

    const method = `${sessionId}:permission`;
    agent.onRpcRequest(async (data) => {
      payloads.push(data);
      return JSON.stringify({ ok: true, echoed: data.params });
    });

    await agent.rpcRegister(method);

    const res1 = await ui.rpcCall<{ ok: boolean; result?: string }>(method, JSON.stringify({ id: 'p1', approved: true }));
    expect(res1.ok).toBe(true);
    expect(typeof res1.result).toBe('string');
    const parsed1 = JSON.parse(res1.result!);
    expect(parsed1.ok).toBe(true);

    // Disconnect agent: method should become unavailable.
    agent.disconnect();
    await waitFor(() => !agent.isConnected(), { timeoutMs: 10_000 });

    const res2 = await ui.rpcCall<{ ok: boolean; error?: string; errorCode?: string }>(
      method,
      JSON.stringify({ id: 'p2', approved: true }),
    );
    expect(res2.ok).toBe(false);
    expect(res2.errorCode).toBe('RPC_METHOD_NOT_AVAILABLE');
    expect(typeof res2.error).toBe('string');

    // Reconnect + re-register: method works again.
    agent.connect();
    await waitFor(() => agent.isConnected(), { timeoutMs: 20_000 });
    await agent.rpcRegister(method);

    const res3 = await ui.rpcCall<{ ok: boolean; result?: string }>(method, JSON.stringify({ id: 'p3', approved: true }));
    expect(res3.ok).toBe(true);

    try {
      passed = true;
    } finally {
      await artifacts.dumpAll(testDir, { onlyIf: saveArtifactsOnSuccess || !passed });
      ui.close();
      agent.close();
    }
  }, 90_000);
});
