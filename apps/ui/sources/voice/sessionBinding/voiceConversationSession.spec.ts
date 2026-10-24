import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { installVoiceSessionBindingCommonModuleMocks } from './voiceSessionBindingTestHelpers';

type TestState = {
  settings: any;
  machines: Record<string, any>;
  sessions: Record<string, any>;
  getProjectForSession?: (sessionId: string) => { key?: { machineId?: string; path?: string } } | null;
};

let state: TestState;
const machineSpawnNewSession = vi.fn();
const refreshSessions = vi.fn();
const patchSessionMetadataWithRetry = vi.fn();
const ensureSessionVisibleForMessageRoute = vi.fn();

vi.mock('@/agents/registry/registryCore', () => ({
  isAgentId: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
  getActiveServerAccountScope: () => ({ serverId: 'server-1', accountId: 'account-1' }),
}));

vi.mock('@/sync/domains/session/directSessions/readDirectSessionLink', () => ({
  readDirectSessionLink: () => null,
}));

installVoiceSessionBindingCommonModuleMocks({
  storage: () => {
    return createStorageModuleStub({
      storage: {
        getState: () => state,
      },
    });
  },
});

vi.mock('@/sync/ops/machines', () => ({
  machineSpawnNewSession: (...args: any[]) => machineSpawnNewSession(...args),
  machineSpawnNewSessionUntilResolved: (...args: any[]) => machineSpawnNewSession(...args),
  completeMachineSpawnAttemptCustody: vi.fn(async () => true),
}));

vi.mock('@/sync/sync', () => ({
  sync: {
    refreshSessions: (...args: any[]) => refreshSessions(...args),
    patchSessionMetadataWithRetry: (...args: any[]) => patchSessionMetadataWithRetry(...args),
    ensureSessionVisibleForMessageRoute: (...args: any[]) => ensureSessionVisibleForMessageRoute(...args),
  },
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
  isMachineOnline: () => true,
}));

vi.mock('@/voice/runtime/voiceTargetStore', () => ({
  useVoiceTargetStore: {
    getState: () => ({
      primaryActionSessionId: null,
      lastFocusedSessionId: null,
    }),
  },
}));

describe('ensureVoiceConversationSessionForVoiceHome', () => {
  beforeEach(() => {
    vi.resetModules();
    machineSpawnNewSession.mockReset();
    refreshSessions.mockReset();
    patchSessionMetadataWithRetry.mockReset();
    ensureSessionVisibleForMessageRoute.mockReset();

    state = {
      settings: {
        lastUsedAgent: 'codex',
        recentMachinePaths: [],
        voice: {
          adapters: {
            local_conversation: {
              agent: {
                machineTargetMode: 'auto',
                agentSource: 'session',
                voiceHomeSubdirName: 'voice-agent',
              },
            },
          },
        },
      },
      machines: {
        'machine-1': {
          id: 'machine-1',
          active: true,
          metadata: {
            happyHomeDir: '/Users/test/.happier',
          },
        },
      },
      sessions: {},
      getProjectForSession: () => null,
    };

    machineSpawnNewSession.mockImplementation(async (params: any) => {
      state.sessions['voice-home-session'] = {
        id: 'voice-home-session',
        active: true,
        updatedAt: 1,
        metadata: {
          machineId: params.machineId,
          path: params.directory,
        },
      };
      return {
        type: 'success',
        sessionId: 'voice-home-session',
        spawnAttemptCustody: {
          status: 'completed',
          userAttemptId: params.userAttemptId,
          spawnNonce: 'voice-home-nonce',
          targetFingerprint: 'voice-home-target',
        },
      };
    });

    patchSessionMetadataWithRetry.mockImplementation(async (sessionId: string, applyPatch: (metadata: any) => any) => {
      const session = state.sessions[sessionId];
      session.metadata = applyPatch(session.metadata ?? {});
    });
  });

  it('spawns on the preferred machine when auto mode has no active voice target session', async () => {
    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).resolves.toBe('voice-home-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1',
      directory: '/Users/test/.happier/voice-agent',
      serverId: 'server-1',
    }));
  });

  it('falls back to another available auto target when the sticky auto-target machine no longer resolves a voice-home directory', async () => {
    state.settings.voice.adapters.local_conversation.agent.autoTargetMachineId = 'stale-machine';
    state.machines['stale-machine'] = {
      id: 'stale-machine',
      active: true,
      metadata: {},
    };

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).resolves.toBe('voice-home-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1',
      directory: '/Users/test/.happier/voice-agent',
      serverId: 'server-1',
    }));
  });

  it('falls back to another available auto target when the sticky auto-target machine is inactive', async () => {
    state.settings.voice.adapters.local_conversation.agent.autoTargetMachineId = 'stale-machine';
    state.machines['stale-machine'] = {
      id: 'stale-machine',
      active: false,
      metadata: {
        happyHomeDir: '/Users/stale/.happier',
      },
    };

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).resolves.toBe('voice-home-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1',
      directory: '/Users/test/.happier/voice-agent',
      serverId: 'server-1',
    }));
  });

  it('routes recent voice-home spawn targets through active machine replacements', async () => {
    state.settings.recentMachinePaths = [{
      machineId: 'machine-old',
      path: '/other/account',
    }];
    state.settings.machinePathPreferencesByTargetV1 = {
      [JSON.stringify(['server-1', 'account-1', 'machine-old'])]: {
        favorites: [], recentPaths: ['/Users/test/.happier/voice-agent'],
      },
    };
    state.machines = {
      'machine-old': {
        id: 'machine-old',
        active: false,
        replacedByMachineId: 'machine-new',
        replacedAt: 123,
        metadata: {},
      },
      'machine-new': {
        id: 'machine-new',
        active: true,
        metadata: {},
      },
    };

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).resolves.toBe('voice-home-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-new',
      directory: '/Users/test/.happier/voice-agent',
      serverId: 'server-1',
    }));
  });

  it('uses the reachable target machine when the focused session metadata is stale after handoff', async () => {
    state.machines['machine-target'] = {
      id: 'machine-target',
      active: true,
      metadata: {
        happyHomeDir: '/Users/target/.happier',
        host: 'target.local',
      },
    };
    state.machines['machine-stale'] = {
      id: 'machine-stale',
      active: false,
      replacedByMachineId: 'machine-target',
      replacedAt: 123,
      metadata: {
        host: 'source.local',
      },
    };
    state.sessions['focus-session'] = {
      id: 'focus-session',
      active: true,
      updatedAt: 5,
      metadata: {
        machineId: 'machine-stale',
        path: '/Users/test/workspace/rebound',
        homeDir: '/Users/test',
        host: 'source.local',
      },
    };
    state.getProjectForSession = (sessionId: string) =>
      sessionId === 'focus-session'
        ? {
            key: {
              machineId: 'machine-target',
              path: '/Users/test/workspace/rebound',
            },
          }
        : null;

    vi.doMock('@/voice/runtime/voiceTargetStore', () => ({
      useVoiceTargetStore: {
        getState: () => ({
          primaryActionSessionId: 'focus-session',
          lastFocusedSessionId: null,
        }),
      },
    }));

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).resolves.toBe('voice-home-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-target',
      directory: '/Users/target/.happier/voice-agent',
      serverId: 'server-1',
    }));
  });

  it('does not recover or mutate a newer ordinary same-target session after an unresolved spawn', async () => {
    machineSpawnNewSession.mockResolvedValue({
      type: 'error',
      errorCode: 'SESSION_WEBHOOK_TIMEOUT',
      errorMessage: 'Session startup timed out',
    });
    refreshSessions.mockImplementation(async () => {
      state.sessions['ordinary-session'] = {
        id: 'ordinary-session',
        active: true,
        updatedAt: 2,
        metadata: {},
      };
    });
    ensureSessionVisibleForMessageRoute.mockImplementation(async (sessionId: string) => {
      if (sessionId !== 'ordinary-session') return;
      state.sessions['ordinary-session'] = {
        ...state.sessions['ordinary-session'],
        metadata: {
          machineId: 'machine-1',
          path: '/Users/test/.happier/voice-agent',
        },
      };
    });

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).rejects.toMatchObject({
      code: 'SESSION_WEBHOOK_TIMEOUT',
    });
    expect(patchSessionMetadataWithRetry).not.toHaveBeenCalledWith(
      'ordinary-session',
      expect.any(Function),
    );
  });

  it('does not claim a session rejoined from a different voice-home spawn attempt', async () => {
    state.sessions['ordinary-session'] = {
      id: 'ordinary-session',
      active: true,
      updatedAt: 2,
      metadata: { machineId: 'machine-1', path: '/Users/test/.happier/voice-agent' },
    };
    machineSpawnNewSession.mockResolvedValue({
      type: 'success',
      sessionId: 'ordinary-session',
      spawnAttemptCustody: {
        status: 'completed',
        userAttemptId: 'different-attempt',
        spawnNonce: 'different-nonce',
        targetFingerprint: 'target-a',
      },
    });

    const { ensureVoiceConversationSessionForVoiceHome } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForVoiceHome()).rejects.toThrow('voice_conversation_spawn_failed');
    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      userAttemptId: expect.stringMatching(/^ui-session-attempt-/),
    }));
    expect(patchSessionMetadataWithRetry).not.toHaveBeenCalled();
  });
});

describe('ensureVoiceConversationSessionForSessionRoot', () => {
  beforeEach(() => {
    vi.resetModules();
    machineSpawnNewSession.mockReset();
    refreshSessions.mockReset();
    patchSessionMetadataWithRetry.mockReset();
    ensureSessionVisibleForMessageRoute.mockReset();

    state = {
      settings: {
        lastUsedAgent: 'codex',
        recentMachinePaths: [],
        voice: {
          adapters: {
            local_conversation: {
              agent: {
                machineTargetMode: 'auto',
                agentSource: 'session',
                voiceHomeSubdirName: 'voice-agent',
              },
            },
          },
        },
      },
      machines: {
        'machine-stale': {
          id: 'machine-stale',
          active: false,
          replacedByMachineId: 'machine-target',
          replacedAt: 123,
          metadata: {
            host: 'source.local',
          },
        },
        'machine-target': {
          id: 'machine-target',
          active: true,
          metadata: {
            happyHomeDir: '/Users/target/.happier',
            host: 'target.local',
          },
        },
      },
      sessions: {},
      getProjectForSession: () => null,
    };

    machineSpawnNewSession.mockImplementation(async (params: any) => {
      state.sessions['voice-root-session'] = {
        id: 'voice-root-session',
        active: true,
        updatedAt: 1,
        metadata: {
          machineId: params.machineId,
          path: params.directory,
        },
      };
      return {
        type: 'success',
        sessionId: 'voice-root-session',
        spawnAttemptCustody: {
          status: 'completed',
          userAttemptId: params.userAttemptId,
          spawnNonce: 'voice-root-nonce',
          targetFingerprint: 'voice-root-target',
        },
      };
    });

    patchSessionMetadataWithRetry.mockImplementation(async (sessionId: string, applyPatch: (metadata: any) => any) => {
      const session = state.sessions[sessionId];
      session.metadata = applyPatch(session.metadata ?? {});
    });
  });

  it('spawns on the reachable target machine when the root session metadata machine id is stale after handoff', async () => {
    state.sessions['root-session'] = {
      id: 'root-session',
      active: true,
      updatedAt: 5,
      metadata: {
        machineId: 'machine-stale',
        path: '/Users/test/workspace/rebound',
        homeDir: '/Users/test',
        host: 'source.local',
      },
    };
    state.getProjectForSession = (sessionId: string) =>
      sessionId === 'root-session'
        ? {
            key: {
              machineId: 'machine-target',
              path: '/Users/test/workspace/rebound',
            },
          }
        : null;

    const { ensureVoiceConversationSessionForSessionRoot } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForSessionRoot({ sessionId: 'root-session' })).resolves.toBe('voice-root-session');

    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-target',
      directory: '/Users/test/workspace/rebound',
      serverId: 'server-1',
    }));
  });

  it('does not claim a session rejoined from a different session-root spawn attempt', async () => {
    state.sessions['root-session'] = {
      id: 'root-session',
      active: true,
      updatedAt: 5,
      metadata: {
        machineId: 'machine-target',
        path: '/Users/test/workspace/rebound',
        homeDir: '/Users/test',
        host: 'target.local',
      },
    };
    state.sessions['ordinary-session'] = {
      id: 'ordinary-session',
      active: true,
      updatedAt: 2,
      metadata: { machineId: 'machine-target', path: '/Users/test/workspace/rebound' },
    };
    state.getProjectForSession = (sessionId: string) => sessionId === 'root-session'
      ? { key: { machineId: 'machine-target', path: '/Users/test/workspace/rebound' } }
      : null;
    machineSpawnNewSession.mockResolvedValue({
      type: 'success',
      sessionId: 'ordinary-session',
      spawnAttemptCustody: {
        status: 'completed',
        userAttemptId: 'different-attempt',
        spawnNonce: 'different-nonce',
        targetFingerprint: 'target-a',
      },
    });

    const { ensureVoiceConversationSessionForSessionRoot } = await import('./voiceConversationSession');

    await expect(ensureVoiceConversationSessionForSessionRoot({ sessionId: 'root-session' }))
      .rejects.toThrow('voice_conversation_spawn_failed');
    expect(machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
      userAttemptId: expect.stringMatching(/^ui-session-attempt-/),
    }));
    expect(patchSessionMetadataWithRetry).not.toHaveBeenCalled();
  });
});
