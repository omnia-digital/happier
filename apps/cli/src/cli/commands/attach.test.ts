import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildProcess, type spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials, Settings } from '@/persistence';
import { createApiSessionClientFixture, createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { updateSessionAgentStateWithAck } from '@/api/session/stateUpdates';
import type { AgentState, Metadata } from '@/api/types';
import { createOpenCodeSharedLocalControl } from '@/backends/opencode/localControl/createOpenCodeSharedLocalControl';
import { createOpenCodeTuiSupervisor } from '@/backends/opencode/localControl/openCodeTuiSupervisor';
import { resolveOpenCodeLocalControlSupport } from '@/backends/opencode/localControl/resolveOpenCodeLocalControlSupport';
import { runOpenCodeProviderAttach } from '@/backends/opencode/attach/runOpenCodeProviderAttach';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { buildCodexAgentRuntimeDescriptor } from '@happier-dev/agents';
import { createCodexSharedLocalControl } from '@/backends/codex/localControl/createCodexSharedLocalControl';
import { createCodexSharedAttachArgs } from '@/backends/codex/localControl/createCodexSharedAttachArgs';
import { createAttachedTerminalSupervisor } from '@/agent/localControl/createAttachedTerminalSupervisor';
import { terminalLauncherBoundary, expectTerminalNativeInvocation } from '@/testkit/process/terminalLauncher';
import { createTerminalAttachmentId, readTerminalAttachmentInfo, writeTerminalAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { buildTerminalHostHandleFromAttachmentMetadata } from '@/agent/runtime/terminal/attachmentMetadata';
import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { acquireSessionRunnerLock } from '@/daemon/sessionRunnerLock';

import { handleAttachCommand } from './attach';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
// The real command, provider preparation and ACK writer run beneath this network boundary.
vi.mock('socket.io-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('socket.io-client')>(),
  io: mockIo,
}));

function createRunnerControlHarness(metadata: Metadata, sessionId: string, rpcFailure?: 'rejected' | 'malformed') {
  const session = createApiSessionClientFixture({ metadata });
  const rpc = new RpcHandlerManager({
    scopePrefix: sessionId, encryptionMode: 'plain', encryptionKey: new Uint8Array(32),
    encryptionVariant: 'legacy', logger: () => undefined,
  });
  Object.assign(session, { rpcHandlerManager: rpc });
  let relayState: AgentState | null = null;
  let relayVersion = 0;
  const createSocket = () => createApiSessionSocketStub({
    onConnect: (socket) => queueMicrotask(() => socket.trigger('connect')),
    emitWithAck: (event, payload) => {
      expect(event).toBe('update-state');
      // The transport owns version arbitration; the real ACK writer remains below it.
      const request = payload as { expectedVersion: number; agentState: string };
      if (request.expectedVersion !== relayVersion) {
        return { result: 'version-mismatch', agentState: JSON.stringify(relayState), version: relayVersion };
      }
      relayState = JSON.parse(request.agentState) as AgentState;
      return { result: 'success', agentState: request.agentState, version: ++relayVersion };
    },
    emit: (event, args) => {
      if (event !== SOCKET_RPC_EVENTS.CALL) return;
      const request = args[0] as Parameters<typeof rpc.handleRequest>[0];
      const acknowledge = args[1];
      if (typeof acknowledge !== 'function') throw new Error('Missing RPC acknowledgement');
      if (rpcFailure && request.method.endsWith(':switch')) {
        acknowledge(rpcFailure === 'rejected'
          ? { ok: false, error: 'Switch transport rejected' }
          : { ok: true, result: { ok: true } });
        return;
      }
      void rpc.handleRequest(request).then((result) => acknowledge({ ok: true, result }));
    },
  });
  mockIo.mockImplementation(createSocket);
  const runnerSocket = createSocket();
  runnerSocket.connect();
  let runnerState: AgentState | null = null;
  let runnerVersion = 0;
  session.updateAgentState = (handler) => updateSessionAgentStateWithAck({
    socket: runnerSocket, sessionId, sessionEncryptionMode: 'plain',
    encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy',
    getAgentState: () => runnerState, setAgentState: (value) => { runnerState = value; },
    getAgentStateVersion: () => runnerVersion, setAgentStateVersion: (value) => { runnerVersion = value; },
    syncSessionSnapshotFromServer: async () => { runnerState = relayState; runnerVersion = relayVersion; },
    handler,
  });
  return { session, rpc, readRelayState: () => relayState, readRelayVersion: () => relayVersion };
}

describe('happier attach', () => {
  const localSettings = { machineId: 'machine-local' } as Settings;
  const previousManagedServerStatePath = process.env.HAPPIER_OPENCODE_SERVER_STATE_PATH;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as any);

  beforeEach(() => {
    exitSpy.mockClear();
    // Older host fixtures receive the released switch ACK at the transport boundary.
    // Deciding custody cases replace this with the real runner RPC authority above.
    mockIo.mockReset().mockImplementation(() => createApiSessionSocketStub({
      onConnect: (socket) => queueMicrotask(() => socket.trigger('connect')),
      emit: (event, args) => {
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const acknowledge = args[1];
        if (typeof acknowledge === 'function') acknowledge({ ok: true, result: true });
      },
    }));
  });

  afterEach(() => {
    if (previousManagedServerStatePath === undefined) {
      delete process.env.HAPPIER_OPENCODE_SERVER_STATE_PATH;
    } else {
      process.env.HAPPIER_OPENCODE_SERVER_STATE_PATH = previousManagedServerStatePath;
    }
    vi.unstubAllGlobals();
  });

  it('rejects explicit tmux attach for sessions from another machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rawSession = createSessionRecordFixture({
      id: 'sid_remote_tmux_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-remote',
        path: '/tmp/claude-workspace',
        flavor: 'claude',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
          },
        },
      }),
    });

    await expect((handleAttachCommand as any)(['sid_remote_tmux_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async (): Promise<Settings> => ({ machineId: 'machine-local' } as Settings),
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => null,
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
    })).rejects.toThrow('process.exit(1)');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session belongs to another machine and cannot be attached from this computer.'));
    errorSpy.mockRestore();
  });

  it('allows explicit remote provider attach when machine ownership is missing', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_opencode_missing_machine_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '/tmp/opencode-workspace',
        host: 'test',
        flavor: 'opencode',
        opencodeSessionId: 'vendor-session-1',
        opencodeBackendMode: 'server',
        opencodeServerBaseUrl: 'http://127.0.0.1:4096/',
        opencodeServerBaseUrlExplicit: true,
      }),
    });
    const runProviderAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_opencode_missing_machine_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async (): Promise<Settings> => ({ machineId: 'machine-local' } as Settings),
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => null,
      runProviderAttachFn,
      runTmuxAttachFn: vi.fn(async () => 0),
    });

    expect(runProviderAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'opencode',
      sessionId: 'sid_opencode_missing_machine_1',
    }));
  });

  it('attaches the existing local OpenCode terminal after machine id drift', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'happier-opencode-attach-command-'));
    process.env.HAPPIER_OPENCODE_SERVER_STATE_PATH = join(stateDir, 'managed-server.json');
    await writeFile(process.env.HAPPIER_OPENCODE_SERVER_STATE_PATH, JSON.stringify({
      baseUrl: 'http://127.0.0.1:4096/',
      pid: 12345,
      startedAtMs: Date.now(),
      status: 'ready',
    }));

    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_opencode_local_marker_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-before-reauth',
        path: '/tmp/opencode-workspace',
        host: 'test',
        flavor: 'opencode',
        opencodeSessionId: 'vendor-session-1',
        opencodeBackendMode: 'server',
      }),
    });
    const runProviderAttachFn = vi.fn(async () => 0);
    const runTmuxAttachFn = vi.fn(async () => 0);

    const attachmentId = createTerminalAttachmentId();
    await (handleAttachCommand as any)(['sid_opencode_local_marker_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async (): Promise<Settings> => ({ machineId: 'machine-after-reauth' } as Settings),
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 2,
        attachmentId,
        handle: { attachmentId, kind: 'tmux', sessionName: 'happy', paneId: 'opencode-1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' } },
        sessionId: 'sid_opencode_local_marker_1',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:opencode-1' },
        },
        updatedAt: Date.now(),
      }),
      runProviderAttachFn,
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sid_opencode_local_marker_1',
    }));
    expect(runProviderAttachFn).not.toHaveBeenCalled();
  });

  it('shows local rows plus probeable remote provider rows in interactive attach', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const fetchSessionsPageFn = vi.fn(async () => ({
      sessions: [
        createSessionRecordFixture({
          id: 'sid_attachable_1',
          active: true,
          updatedAt: 20,
          encryptionMode: 'plain',
          metadata: JSON.stringify({
            machineId: 'machine-local',
            flavor: 'claude',
            tag: 'repo-a',
            path: '/tmp/repo-a',
            terminal: {
              mode: 'tmux',
              requested: 'tmux',
              tmux: { target: 'happy:attachable-1' },
            },
          }),
        }),
        createSessionRecordFixture({
          id: 'sid_not_attachable_1',
          active: true,
          updatedAt: 10,
          encryptionMode: 'plain',
          metadata: JSON.stringify({
            machineId: 'machine-local',
            flavor: 'codex',
            tag: 'repo-b',
            path: '/tmp/repo-b',
            terminal: {
              mode: 'plain',
              requested: 'tmux',
            },
          }),
        }),
        createSessionRecordFixture({
          id: 'sid_remote_tmux_1',
          active: true,
          updatedAt: 30,
          encryptionMode: 'plain',
          metadata: JSON.stringify({
            machineId: 'machine-remote',
            flavor: 'claude',
            path: '/tmp/remote',
            terminal: {
              mode: 'tmux',
              requested: 'tmux',
              tmux: { target: 'happy:remote-1' },
            },
          }),
        }),
        createSessionRecordFixture({
          id: 'sid_remote_opencode_1',
          active: true,
          updatedAt: 35,
          encryptionMode: 'plain',
          metadata: JSON.stringify({
            machineId: 'machine-remote',
            flavor: 'opencode',
            tag: 'remote-server',
            path: '/srv/opencode',
            opencodeSessionId: 'remote-opencode-session-1',
            opencodeBackendMode: 'server',
            opencodeServerBaseUrl: 'https://remote.example.test/',
            opencodeServerBaseUrlExplicit: true,
          }),
        }),
        createSessionRecordFixture({
          id: 'sid_inactive_1',
          active: false,
          updatedAt: 40,
          encryptionMode: 'plain',
          metadata: JSON.stringify({
            machineId: 'machine-local',
            flavor: 'claude',
            path: '/tmp/inactive',
            terminal: {
              mode: 'tmux',
              requested: 'tmux',
              tmux: { target: 'happy:inactive-1' },
            },
          }),
        }),
      ],
      nextCursor: null,
      hasNext: false,
    }));
    const selectAttachableSessionIdFn = vi.fn(async ({
      rows,
      probeSessionIdFn,
    }: {
      rows: Array<Record<string, unknown>>;
      probeSessionIdFn?: (sessionId: string) => Promise<{ reachable: boolean; reason?: string }>;
    }) => {
      expect(rows).toHaveLength(4);
      const byId = new Map(rows.map(row => [row.sessionId, row]));
      expect(byId.get('sid_attachable_1')).toMatchObject({
        sessionId: 'sid_attachable_1',
        disabled: false,
      });
      expect(byId.get('sid_remote_opencode_1')).toMatchObject({
        sessionId: 'sid_remote_opencode_1',
        disabled: true,
        annotation: 'remote',
        disabledReason: 'Press P to check remote reachability.',
        probeable: true,
      });
      expect(byId.get('sid_not_attachable_1')).toMatchObject({
        sessionId: 'sid_not_attachable_1',
        disabled: true,
      });
      expect(String(byId.get('sid_not_attachable_1')?.disabledReason)).toMatch(/outside tmux|not started in tmux/i);
      expect(byId.get('sid_inactive_1')).toMatchObject({ disabled: true });

      await expect(probeSessionIdFn?.('sid_remote_opencode_1')).resolves.toMatchObject({
        reachable: true,
      });

      return { type: 'selected', sessionId: 'sid_attachable_1' };
    });
    const runTmuxAttachFn = vi.fn(async () => 0);
    const runProviderAttachFn = vi.fn(async () => 0);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ healthy: true, version: '1.2.15' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await (handleAttachCommand as any)([], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async (): Promise<Settings> => ({ machineId: 'machine-local' } as Settings),
      fetchSessionsPageFn,
      fetchSessionByIdFn: async ({ sessionId }: { sessionId: string }) => {
        const page = await fetchSessionsPageFn();
        return page.sessions.find((row: { id: string }) => row.id === sessionId) ?? null;
      },
      canUseInkSelectorFn: () => true,
      selectAttachableSessionIdFn,
      readTerminalAttachmentInfoFn: async ({ sessionId }: { sessionId: string }) => sessionId === 'sid_attachable_1'
        ? {
            version: 1,
            sessionId,
            updatedAt: Date.now(),
            terminal: {
              mode: 'tmux',
              requested: 'tmux',
              tmux: { target: 'happy:attachable-1' },
            },
          }
        : null,
      runProviderAttachFn,
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sid_attachable_1' }));
    expect(runProviderAttachFn).not.toHaveBeenCalled();
  });

  it('dispatches provider-native attach for provider-attach local-control sessions', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_opencode_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/opencode-workspace',
        host: 'test',
        flavor: 'opencode',
        opencodeSessionId: 'opencode-session-1',
        opencodeBackendMode: 'server',
        opencodeServerBaseUrl: 'http://127.0.0.1:4096/',
        opencodeServerBaseUrlExplicit: true,
      }),
    });
    const runProviderAttachFn = vi.fn(async () => 0);
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_opencode_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      runProviderAttachFn,
      runTmuxAttachFn,
      readTerminalAttachmentInfoFn: async () => null,
      isTmuxAvailableFn: async () => true,
    });

    expect(runProviderAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'opencode',
      metadata: expect.objectContaining({
        path: '/tmp/opencode-workspace',
        opencodeSessionId: 'opencode-session-1',
      }),
      sessionId: 'sid_opencode_1',
    }));
    expect(runTmuxAttachFn).not.toHaveBeenCalled();
  });

  it.each([
    { owned: true, outcome: 'exit' },
    { owned: true, outcome: 'spawn-error' },
    { owned: false, outcome: 'exit' },
  ] as const)('standalone native attach preserves runner custody: $owned / $outcome', async ({ owned, outcome }) => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const sessionId = 'test-session-id';
    const nativeId = 'opencode-session-1';
    const metadata = createTestMetadata({
      machineId: 'machine-local', path: '/tmp/opencode-workspace', flavor: 'opencode',
      opencodeSessionId: nativeId, opencodeBackendMode: 'server',
      opencodeServerBaseUrl: 'https://opencode.test/', opencodeServerBaseUrlExplicit: true,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: '2.0.20', pid: 1, urls: [], paths: {},
    }), { status: 200 })));

    const { session, rpc, readRelayState, readRelayVersion } = createRunnerControlHarness(metadata, sessionId);
    const managedChild = new ChildProcess();
    const managedKill = vi.spyOn(managedChild, 'kill').mockImplementation(() => {
      Object.defineProperty(managedChild, 'exitCode', { value: 0, configurable: true });
      managedChild.emit('exit', 0, null);
      return true;
    });
    // Only child-process creation is replaced, not either attachment owner.
    const managedSpawn = vi.fn(() => terminalLauncherBoundary(managedChild)) as unknown as typeof spawn;
    const supervisor = createOpenCodeTuiSupervisor({ command: 'opencode-fixture', env: {}, spawnProcess: managedSpawn });
    const controller = createOpenCodeSharedLocalControl({
      support: resolveOpenCodeLocalControlSupport({ backendMode: 'server', hasTTY: true }),
      startingMode: owned ? 'local' : 'remote', getSession: () => session,
      getSessionId: () => nativeId, getDirectory: () => metadata.path,
      getServerTarget: () => ({ baseUrl: metadata.opencodeServerBaseUrl! }), supervisor,
    });
    rpc.registerHandler(SESSION_RPC_METHODS.SESSION_PROVIDER_CLI_ATTACH_PREPARE_V1, controller.prepareProviderCliAttach);
    await controller.onAfterStart();
    await vi.waitFor(() => expect(readRelayState()?.localControl?.attached).toBe(owned));
    const rawSession = createSessionRecordFixture({
      id: sessionId, active: true, encryptionMode: 'plain', metadata: JSON.stringify(metadata),
      agentState: JSON.stringify(readRelayState()), agentStateVersion: readRelayVersion(),
    });
    const standaloneChild = new ChildProcess();
    const standaloneKill = vi.spyOn(standaloneChild, 'kill');
    const standaloneSpawn = vi.fn(() => terminalLauncherBoundary(standaloneChild));
    const command = handleAttachCommand([sessionId], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      runProviderAttachFn: (params) => runOpenCodeProviderAttach({
        ...params, command: 'opencode-fixture', commandArgs: [], env: {},
        spawnProcess: standaloneSpawn as unknown as typeof spawn,
      }),
      readTerminalAttachmentInfoFn: async () => null,
    });
    const settled = command.then(() => null, (error: unknown) => error);
    try {
      await vi.waitFor(() => expect(standaloneSpawn).toHaveBeenCalled());
      await expectTerminalNativeInvocation(standaloneSpawn.mock.calls, 'opencode-fixture',
        ['--server', metadata.opencodeServerBaseUrl, '--session', nativeId, metadata.path],
        expect.objectContaining({ stdio: 'inherit', shell: false }));
      expect(readRelayState()).toMatchObject({ controlledByUser: false, localControl: {
        attached: owned, canDetach: owned, remoteWritable: true, topology: 'shared',
      } });
      if (outcome === 'spawn-error') standaloneChild.emit('error', new Error('OS spawn failed'));
      else standaloneChild.emit('exit', 0, null);
      const result = await settled;
      if (outcome === 'spawn-error') expect(result).toEqual(new Error('process.exit(1)'));
      else expect(result).toBeNull();
      expect(readRelayState()?.localControl).toMatchObject({ attached: owned, canDetach: owned, remoteWritable: true });
      expect(supervisor.isAttached()).toBe(owned);
      expect(managedKill).not.toHaveBeenCalled();
      expect(await rpc.invokeLocal('switch', { to: 'remote' })).toBe(true);
      await vi.waitFor(() => expect(readRelayState()?.localControl?.attached).toBe(false));
      if (owned) expect(managedKill).toHaveBeenCalledWith('SIGINT');
      expect(standaloneKill).not.toHaveBeenCalled();
      expect(readRelayState()?.localControl?.remoteWritable).toBe(true);
    } finally {
      standaloneChild.emit('exit', 0, null);
      await settled;
      await controller.dispose();
    }
  });

  it.each([
    { host: 'herdr', outcome: 'detached' },
    { host: 'tmux', outcome: 'detached' },
    { host: 'zellij', outcome: 'detached' },
    { host: 'windows_terminal', outcome: 'detached' },
    { host: 'windows_console', outcome: 'detached' },
    { host: 'windows_console', outcome: 'replaced' },
    { host: 'herdr', outcome: 'attached' },
    { host: 'herdr', outcome: 'codex' },
    { host: 'herdr', outcome: 'unavailable' },
    { host: 'herdr', outcome: 'rejected' },
    { host: 'herdr', outcome: 'malformed' },
  ] as const)('hosted shared attach restores runner custody before host focus: $host / $outcome', async ({ host, outcome }) => {
    await withConfiguredDaemonTestHome({ prefix: 'attach-managed-host-' }, async ({ homeDir }) => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const sessionId = 'test-session-id';
    const nativeId = 'opencode-session-1';
    const terminal: NonNullable<Metadata['terminal']> = host === 'herdr'
      ? { mode: host, requested: host, herdr: { sessionName: 'owned', socketPath: '/tmp/owned.sock', terminalId: 'owned-term', paneId: 'owned-pane' } }
      : host === 'tmux'
        ? { mode: host, requested: host, tmux: { target: 'owned:1' } }
        : host === 'zellij'
          ? { mode: host, requested: host, zellij: { sessionName: 'owned', paneId: 'owned-pane' } }
          : host === 'windows_terminal'
            ? { mode: host, requested: host, windows: { host, windowId: 'owned-window', title: 'owned-tab', pid: 12345 } }
            : { mode: host, requested: 'console', windows: { host: 'console', pid: 12345 } };
    const metadata = createTestMetadata({
      machineId: 'machine-local', path: '/tmp/provider-workspace', terminal,
      ...(outcome === 'codex'
        ? { flavor: 'codex', agentRuntimeDescriptorV1: buildCodexAgentRuntimeDescriptor({ backendMode: 'appServer', vendorSessionId: nativeId }) }
        : { flavor: 'opencode', opencodeSessionId: nativeId, opencodeBackendMode: 'server',
            opencodeServerBaseUrl: 'https://opencode.test/', opencodeServerBaseUrlExplicit: true }),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: '2.0.20', pid: 1, urls: [], paths: {},
    }), { status: 200 })));
    const { session, rpc, readRelayState } = createRunnerControlHarness(
      metadata, sessionId, outcome === 'rejected' || outcome === 'malformed' ? outcome : undefined,
    );
    const children: ChildProcess[] = [];
    const spawnProcess = vi.fn(() => {
      const child = terminalLauncherBoundary(new ChildProcess());
      let exitCode: number | null = null;
      Object.defineProperty(child, 'exitCode', { get: () => exitCode });
      vi.spyOn(child, 'kill').mockImplementation(() => {
        exitCode = 0;
        child.emit('exit', 0, null);
        return true;
      });
      children.push(child);
      return terminalLauncherBoundary(child);
    });
    let targetAvailable = true;
    const { supervisor, controller } = (() => {
      if (outcome === 'codex') {
        const supervisor = createAttachedTerminalSupervisor({
          env: {}, spawnProcess: spawnProcess as unknown as typeof spawn,
          resolveInvocation: (target: Parameters<typeof createCodexSharedAttachArgs>[0]) => ({
            command: 'codex-fixture', args: createCodexSharedAttachArgs(target),
          }),
        });
        const controller = createCodexSharedLocalControl({
          startingMode: 'local', getSession: () => session,
          getSessionId: () => nativeId, directory: metadata.path, endpoint: 'unix:///tmp/codex-owned.sock',
          supervisor,
        });
        return { supervisor, controller };
      }
      const supervisor = createOpenCodeTuiSupervisor({
        command: 'opencode-fixture', env: {}, spawnProcess: spawnProcess as unknown as typeof spawn,
      });
      const controller = createOpenCodeSharedLocalControl({
        support: resolveOpenCodeLocalControlSupport({ backendMode: 'server', hasTTY: true }),
        startingMode: 'local', getSession: () => session,
        getSessionId: () => targetAvailable ? nativeId : null, getDirectory: () => metadata.path,
        getServerTarget: () => ({ baseUrl: metadata.opencodeServerBaseUrl! }), supervisor,
      });
      return { supervisor, controller };
    })();
    const lock = await acquireSessionRunnerLock({ sessionId });
    if (!lock.ok) throw new Error('Synthetic current runner did not claim its lock');
    const attachmentId = createTerminalAttachmentId();
    const handle = buildTerminalHostHandleFromAttachmentMetadata(terminal);
    const attachmentInfo = host === 'windows_terminal' || host === 'windows_console'
      ? { version: 1 as const, sessionId, terminal, updatedAt: 1 }
      : handle ? { version: 2 as const, sessionId, attachmentId, handle: { ...handle, attachmentId }, terminal, updatedAt: 1 } : null;
    if (!attachmentInfo) throw new Error('Synthetic host has no canonical descriptor');
    await writeTerminalAttachmentInfo({ happyHomeDir: homeDir, sessionId,
      terminal,
      ...(attachmentInfo.version === 2 ? { attachmentId, handle: attachmentInfo.handle } : {}),
    });
    try {
      await controller.onAfterStart();
      expect(supervisor.isAttached()).toBe(true);
      if (outcome !== 'attached') {
        expect(await rpc.invokeLocal('switch', { to: 'remote' })).toBe(true);
        expect(supervisor.isAttached()).toBe(false);
      }
      await vi.waitFor(() => expect(readRelayState()?.localControl?.attached).toBe(outcome === 'attached'));
      if (outcome === 'unavailable') targetAvailable = false;
      const rawSession = createSessionRecordFixture({
        id: sessionId, active: true, encryptionMode: 'plain', metadata: JSON.stringify(metadata),
        agentState: JSON.stringify(readRelayState()),
      });
      // Host focus/attach is an OS boundary; observing a waiting controller must not count as success.
      const focusHost = vi.fn(async () => {
        expect(supervisor.isAttached()).toBe(true);
        return 0;
      });
      const command = handleAttachCommand([sessionId], {
        readCredentialsFn: async () => credentials,
        readSettingsFn: async () => localSettings,
        fetchSessionByIdFn: async () => rawSession,
        // Replace only the real persisted OS descriptor between admission and
        // post-switch reread; replacement before admission is a different target.
        readTerminalAttachmentInfoFn: async (input) => {
          const current = await readTerminalAttachmentInfo(input);
          if (outcome === 'replaced' && current?.terminal.windows?.pid === 12345) {
            await writeTerminalAttachmentInfo({ happyHomeDir: homeDir, sessionId,
              terminal: { ...terminal, windows: { host: 'console', pid: 54321 } } });
          }
          return current;
        },
        runHerdrAttachFn: focusHost, runTmuxAttachFn: focusHost, runZellijAttachFn: focusHost,
        runWindowsTerminalAttachFn: focusHost, runWindowsConsoleAttachFn: focusHost,
      });
      if (outcome === 'unavailable' || outcome === 'rejected' || outcome === 'malformed' || outcome === 'replaced') {
        await expect(command).rejects.toThrow();
        expect(focusHost).not.toHaveBeenCalled();
        expect(supervisor.isAttached()).toBe(outcome === 'replaced');
      } else {
        await command;
        expect(focusHost).toHaveBeenCalledOnce();
        expect(children).toHaveLength(outcome === 'attached' ? 1 : 2);
        await vi.waitFor(() => expect(readRelayState()?.localControl).toMatchObject({
          attached: true, canDetach: true, remoteWritable: true, topology: 'shared',
        }));
      }
    } finally {
      await controller.dispose();
      await lock.release();
    }
    });
  });

  it('uses local terminal attachment info for tmux-backed attach on the current machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_claude_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
    });
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_claude_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_claude_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'tmux',
        tmux: expect.objectContaining({ target: 'happy:session-1' }),
      }),
    }));
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('keeps persisted Codex ACP terminal attachment exclusive without requesting a shared TUI', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const terminal = { mode: 'tmux', requested: 'tmux', tmux: { target: 'owned:1' } } as const;
    const rawSession = createSessionRecordFixture({
      id: 'test-session-id', active: true, encryptionMode: 'plain',
      metadata: JSON.stringify(createTestMetadata({
        machineId: 'machine-local', flavor: 'codex', terminal,
        agentRuntimeDescriptorV1: buildCodexAgentRuntimeDescriptor({ backendMode: 'acp' }),
      })),
    });
    const focusHost = vi.fn(async () => 0);
    await handleAttachCommand([rawSession.id], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({ version: 1, sessionId: rawSession.id, terminal, updatedAt: 1 }),
      runTmuxAttachFn: focusHost,
    });
    expect(focusHost).toHaveBeenCalledOnce();
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('uses local terminal attachment info for zellij-backed attach on the current machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_claude_zellij_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        terminal: {
          mode: 'zellij',
          requested: 'zellij',
          zellij: {
            sessionName: 'happy-zellij',
            paneId: 'terminal_7',
          },
        },
      }),
    });
    const runZellijAttachFn = vi.fn(async () => 0);
    const terminal = {
      mode: 'zellij',
      requested: 'zellij',
      zellij: {
        sessionName: 'happy-zellij',
        paneId: 'terminal_7',
      },
    };

    await (handleAttachCommand as any)(['sid_claude_zellij_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_claude_zellij_1',
        updatedAt: Date.now(),
        terminal,
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
      runZellijAttachFn,
    });

    expect(runZellijAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sid_claude_zellij_1',
      terminal: expect.objectContaining({
        mode: 'zellij',
        zellij: expect.objectContaining({ sessionName: 'happy-zellij', paneId: 'terminal_7' }),
      }),
    }));
  });

  it('requests a remote-control banner refresh when attaching to daemon-started tmux sessions', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_daemon_claude_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        startedBy: 'daemon',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
    });
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_daemon_claude_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_daemon_claude_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sid_daemon_claude_1',
      refreshRemoteControl: true,
    }));
  });

  it('falls back to persisted local attachment info when session metadata is unavailable', async () => {
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_local_1'], {
      readCredentialsFn: async () => null,
      fetchSessionByIdFn: async () => null,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_local_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:local-1',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'tmux',
        tmux: expect.objectContaining({ target: 'happy:local-1' }),
      }),
    }));
  });

  it('falls back to persisted zellij attachment info when session metadata is unavailable', async () => {
    const runZellijAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_local_zellij_1'], {
      readCredentialsFn: async () => null,
      fetchSessionByIdFn: async () => null,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_local_zellij_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'zellij',
          requested: 'zellij',
          zellij: {
            sessionName: 'happy-local-zellij',
            paneId: 'terminal_8',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
      runZellijAttachFn,
    });

    expect(runZellijAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'zellij',
        zellij: expect.objectContaining({ sessionName: 'happy-local-zellij' }),
      }),
    }));
  });

  it('dispatches Windows Terminal host attach for windows terminal metadata', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_windows_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: 'C:\\\\workspace',
        host: 'test',
        flavor: 'codex',
        terminal: {
          mode: 'windows_terminal',
          requested: 'windows_terminal',
          windows: {
            host: 'windows_terminal',
            windowId: 'happy-session-1',
          },
        },
      }),
    });
    const runWindowsTerminalAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_windows_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_windows_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'windows_terminal',
          requested: 'windows_terminal',
          windows: {
            host: 'windows_terminal',
            windowId: 'happy-session-1',
          },
        },
      }),
      runProviderAttachFn: vi.fn(async () => 1),
      runTmuxAttachFn: vi.fn(async () => 0),
      runWindowsTerminalAttachFn,
      runWindowsConsoleAttachFn: vi.fn(async () => 0),
    });

    expect(runWindowsTerminalAttachFn).toHaveBeenCalledWith({
      sessionId: 'sid_windows_1',
      terminal: expect.objectContaining({
        mode: 'windows_terminal',
      }),
    });
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('fails with a not-attachable error for hidden Windows sessions', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_windows_hidden_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: 'C:\\\\workspace',
        host: 'test',
        flavor: 'codex',
        terminal: {
          mode: 'plain',
          requested: 'windows_terminal',
          fallbackReason: 'started hidden on Windows',
        },
      }),
    });

    await expect((handleAttachCommand as any)(['sid_windows_hidden_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => null,
      runProviderAttachFn: vi.fn(async () => 1),
      runTmuxAttachFn: vi.fn(async () => 0),
      runWindowsTerminalAttachFn: vi.fn(async () => 0),
      runWindowsConsoleAttachFn: vi.fn(async () => 0),
    })).rejects.toThrow('process.exit(1)');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('This Windows session was started hidden and cannot be attached later.'));
    errorSpy.mockRestore();
  });
});
