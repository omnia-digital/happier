import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ACTION_OPERATION_RPC_METHODS_V1, RPC_METHODS, SPAWN_SESSION_ERROR_CODES } from '@happier-dev/protocol';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';
import { registerMachineRpcHandlers } from './rpcHandlers';

// Host spawn/custody are OS boundaries. RPC normalization, shared admission,
// snapshots, receipt delivery, and historical response adapters remain real.
function createSpawnBoundary() {
  const rpcHandlerManager = new RpcHandlerManager({
    scopePrefix: 'machine-1', encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy',
  });
  let release!: () => void;
  const custody = new Promise<void>(resolve => { release = resolve; });
  const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
    type: 'success', spawnNonce: 'nonce-shared', sessionIdStatus: 'pending',
  }));
  registerMachineRpcHandlers({
    rpcHandlerManager,
    handlers: {
      spawnSession, stopSession: async () => true, requestShutdown: () => {},
      resolveSpawnSessionByNonce: async () => {
        await custody;
        return { status: 'success', sessionId: 'session-created' };
      },
    },
    deps: { getActionOperationScope: async () => ({ accountId: 'account-1', machineId: 'machine-1' }) },
  });
  return {
    invoke: (raw: unknown) => rpcHandlerManager.invokeLocal(RPC_METHODS.SPAWN_HAPPY_SESSION_PROVIDER_SAFE, raw),
    invokeHandoff: (raw: unknown) => rpcHandlerManager.invokeLocal(RPC_METHODS.DAEMON_SESSION_HANDOFF_START, raw),
    list: () => rpcHandlerManager.invokeLocal(ACTION_OPERATION_RPC_METHODS_V1.list, {}),
    spawnSession, release,
  };
}

describe('tracked spawn admission and early receipt', () => {
  it.each(['nonce-shared', ' nonce-shared '])('shares prompt acceptance for normalized nonce %j while final custody remains pending', async (spawnNonce) => {
    const boundary = createSpawnBoundary();
    const request = { spawnNonce, directory: '~/repo', modelId: '   ' };
    const expected = { type: 'success', spawnNonce: 'nonce-shared', sessionIdStatus: 'pending' };
    try {
      expect(await boundary.invoke(request)).toEqual(expected);
      let joined: unknown;
      void boundary.invoke({ spawnNonce: 'nonce-shared', directory: join(homedir(), 'repo') }).then(value => { joined = value; });
      await vi.waitFor(() => expect(joined).toEqual(expected));
      expect(boundary.spawnSession).toHaveBeenCalledTimes(1);
      expect(boundary.spawnSession).toHaveBeenCalledWith(expect.objectContaining({ spawnNonce, directory: join(homedir(), 'repo'), modelId: undefined }));
      expect(await boundary.list()).toMatchObject({ items: [{ actionId: 'session.spawn_new', state: 'running' }] });
    } finally {
      boundary.release();
    }
    await vi.waitFor(async () => expect(await boundary.list()).toMatchObject({ items: [{ state: 'succeeded' }] }));
  });

  it.each(['nonce-shared', ' nonce-shared '])('refuses changed arguments under native nonce alias %j with the canonical spawn error envelope', async (spawnNonce) => {
    const boundary = createSpawnBoundary();
    try {
      await boundary.invoke({ spawnNonce: 'nonce-shared', directory: '/tmp/first' });
      let changed: unknown;
      void boundary.invoke({ spawnNonce, directory: '/tmp/second', environmentVariables: { PRIVATE_VALUE: 'never-expose-this' } }).then(value => { changed = value; });
      await vi.waitFor(() => expect(changed).toMatchObject({ type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST }));
      expect(boundary.spawnSession).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await boundary.list())).not.toContain('never-expose-this');
    } finally {
      boundary.release();
    }
    await vi.waitFor(async () => expect(await boundary.list()).toMatchObject({ items: [{ state: 'succeeded' }] }));
  });

  it('hands a missing-directory question back without recording a failed launch', async () => {
    const boundary = createSpawnBoundary();
    boundary.spawnSession.mockResolvedValueOnce({ type: 'requestToApproveDirectoryCreation', directory: '/tmp/gone' });

    const receipt = await boundary.invoke({ spawnNonce: 'nonce-approval', directory: '/tmp/gone' });

    expect(receipt).toEqual({ type: 'requestToApproveDirectoryCreation', directory: '/tmp/gone' });
    await vi.waitFor(async () => expect(await boundary.list()).toMatchObject({
      items: [{ actionId: 'session.spawn_new', state: 'cancelled' }],
    }));
  });

  it('exposes a changed handoff request conflict rather than replaying the earlier domain response', async () => {
    const boundary = createSpawnBoundary();
    const request = {
      requestId: 'handoff-shared', sessionId: 'session-1', sourceMachineId: 'other-machine',
      targetMachineId: 'target-machine', sessionStorageMode: 'direct',
      preferredTransportStrategies: ['server_routed_stream'],
    };
    // Real coordinator admission rejects the source before it can access any
    // credentials or machines. A changed same-ID request must still conflict.
    expect(await boundary.invokeHandoff(request)).toMatchObject({ ok: false, errorCode: 'machine_mismatch' });
    await expect(boundary.invokeHandoff({ ...request, targetPath: '/different' })).rejects.toThrow();
    expect(await boundary.list()).toMatchObject({ items: [{ actionId: 'session.handoff', state: 'failed' }] });
  });
});
