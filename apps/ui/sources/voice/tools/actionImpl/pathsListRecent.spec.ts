import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installVoiceToolActionImplCommonModuleMocks } from './voiceToolActionImplTestHelpers';

const voiceTargetState = {
    primaryActionSessionId: null as string | null,
    lastFocusedSessionId: null as string | null,
};
let activeScope = { serverId: 'server-a', accountId: 'account-a' };
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => activeScope,
}));

const state: any = {
    sessions: {
        s1: {
            id: 's1',
            active: true,
            presence: 'online',
            updatedAt: 1000,
            metadata: {
                machineId: 'm1',
                path: '/Users/leeroy/projects/happier',
            },
        },
    },
    machines: {
        m1: {
            id: 'm1',
            metadata: { displayName: 'Leeroy MacBook Pro', host: 'leeroy-mbp' },
        },
    },
    settings: {
        voice: {
            privacy: {
                shareDeviceInventory: true,
                shareFilePaths: false,
            },
        },
        recentMachinePaths: [
            { machineId: 'm1', path: '/Users/leeroy/projects/happier' },
        ],
    },
    getProjectForSession: () => null,
};

installVoiceToolActionImplCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: {
                getState: () => state,
            } as typeof import('@/sync/domains/state/storage').storage,
        });
    },
});

vi.mock('@/voice/runtime/voiceTargetStore', () => ({
    useVoiceTargetStore: {
        getState: () => voiceTargetState,
    },
}));

describe('listRecentPathsForVoiceTool', () => {
    beforeEach(() => {
        activeScope = { serverId: 'server-a', accountId: 'account-a' };
        voiceTargetState.primaryActionSessionId = null;
        voiceTargetState.lastFocusedSessionId = null;
        state.sessions = {
            s1: {
                id: 's1',
                active: true,
                presence: 'online',
                updatedAt: 1000,
                metadata: {
                    machineId: 'm1',
                    path: '/Users/leeroy/projects/happier',
                },
            },
        };
        state.machines = {
            m1: {
                id: 'm1',
                metadata: { displayName: 'Leeroy MacBook Pro', host: 'leeroy-mbp' },
            },
        };
        state.settings.voice.privacy.shareDeviceInventory = true;
        state.settings.voice.privacy.shareFilePaths = false;
        state.settings.recentMachinePaths = [{ machineId: 'm1', path: '/Users/leeroy/projects/happier' }];
        state.settings.machinePathPreferencesByTargetV1 = {
            [JSON.stringify(['server-a', 'account-a', 'm1'])]: {
                favorites: [], recentPaths: ['/Users/leeroy/projects/happier'],
            },
        };
        state.getProjectForSession = () => null;
    });

    it('does not suggest a legacy or another account path for the selected machine', async () => {
        state.sessions = {};
        state.settings.recentMachinePaths = [{ machineId: 'm1', path: '/legacy/unassigned' }];
        state.settings.machinePathPreferencesByTargetV1 = {
            [JSON.stringify(['server-a', 'account-a', 'm1'])]: { favorites: [], recentPaths: ['/owned/a'] },
            [JSON.stringify(['server-a', 'account-b', 'm1'])]: { favorites: [], recentPaths: ['/other/b'] },
        };
        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');
        const result: any = await listRecentPathsForVoiceTool({ machineId: 'm1' });
        expect(result.items.map((item: any) => item.label)).toEqual(['a — Leeroy MacBook Pro']);
    });

    it('returns redacted labels without workspace handles when file paths are hidden', async () => {
        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');

        const result: any = await listRecentPathsForVoiceTool({ limit: 10 });

        expect(result).toMatchObject({
            items: [
                {
                    label: 'happier — Leeroy MacBook Pro',
                    lastUsedAt: 1000,
                },
            ],
        });
        expect(result.items[0]).not.toHaveProperty('workspaceId');
        expect(result.items[0]).not.toHaveProperty('path');
    });

    it('still redacts labels when a raw voice privacy blob tries to enable file path sharing', async () => {
        state.settings.voice.privacy.shareFilePaths = true;
        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');

        const result: any = await listRecentPathsForVoiceTool({ limit: 10 });

        expect(result).toMatchObject({
            items: [
                {
                    label: 'happier — Leeroy MacBook Pro',
                    lastUsedAt: 1000,
                },
            ],
        });
        expect(result.items[0]).not.toHaveProperty('workspaceId');
        expect(result.items[0]).not.toHaveProperty('machineId');
        expect(result.items[0]).not.toHaveProperty('path');
    });

    it('keeps the default machine on stable display attribution without explicit replacement', async () => {
        voiceTargetState.primaryActionSessionId = 's1';
        state.sessions = {
            s1: {
                id: 's1',
                active: true,
                presence: 'online',
                updatedAt: 1000,
                metadata: {
                    machineId: 'm-stale',
                    path: '/Users/leeroy/projects/happier',
                    homeDir: '/Users/leeroy',
                    host: 'old-host',
                },
            },
        };
        state.machines = {
            m1: {
                id: 'm1',
                active: true,
                activeAt: 10,
                metadata: { displayName: 'Leeroy MacBook Pro', host: 'leeroy-mbp' },
            },
        };
        state.settings.voice.privacy.shareFilePaths = true;
        state.settings.recentMachinePaths = [];
        state.getProjectForSession = (sessionId: string) =>
            sessionId === 's1'
                ? {
                    key: {
                        machineId: 'm1',
                        path: '/Users/leeroy/projects/happier',
                    },
                }
                : null;

        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');

        const result: any = await listRecentPathsForVoiceTool({ limit: 10 });

        expect(result).toMatchObject({
            items: [
                {
                    label: 'happier — m-stale',
                    lastUsedAt: 1000,
                },
            ],
        });
        expect(result.items[0]).not.toHaveProperty('machineId');
        expect(result.items[0]).not.toHaveProperty('path');
    });

    it('uses stable display attribution for project paths when computing voice recent timestamps', async () => {
        state.sessions = {
            s1: {
                id: 's1',
                active: false,
                presence: 900,
                updatedAt: 1000,
                metadata: {
                    machineId: 'm1',
                    path: '/Users/leeroy/projects/stale',
                    homeDir: '/Users/leeroy',
                },
            },
        };
        state.machines = {
            m1: {
                id: 'm1',
                active: false,
                activeAt: 100,
                metadata: { displayName: 'Leeroy MacBook Pro', host: 'leeroy-mbp' },
            },
        };
        state.settings.recentMachinePaths = [];
        state.settings.machinePathPreferencesByTargetV1 = {};
        state.getProjectForSession = (sessionId: string) =>
            sessionId === 's1'
                ? {
                    key: {
                        machineId: 'm1',
                        path: '/Users/leeroy/projects/current',
                    },
                }
                : null;

        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');

        const result: any = await listRecentPathsForVoiceTool({ machineId: 'm1', limit: 10 });

        expect(result.items).toEqual([
            {
                label: 'current — Leeroy MacBook Pro',
                lastUsedAt: 1000,
            },
        ]);
    });

    it('canonicalizes the default recent-path machine through explicit replacement', async () => {
        state.sessions = {
            s1: {
                id: 's1',
                active: false,
                presence: 900,
                updatedAt: 1000,
                metadata: {
                    machineId: 'm-old',
                    path: '/Users/leeroy/projects/happier',
                    homeDir: '/Users/leeroy',
                },
            },
        };
        state.machines = {
            'm-old': {
                id: 'm-old',
                active: false,
                replacedByMachineId: 'm-new',
                metadata: { displayName: 'Old Machine', host: 'old-host' },
            },
            'm-new': {
                id: 'm-new',
                active: true,
                metadata: { displayName: 'Replacement Machine', host: 'new-host' },
            },
        };
        state.settings.recentMachinePaths = [
            { machineId: 'm-old', path: '/Users/leeroy/projects/happier' },
        ];
        state.settings.machinePathPreferencesByTargetV1 = {
            [JSON.stringify(['server-a', 'account-a', 'm-old'])]: {
                favorites: [], recentPaths: ['/Users/leeroy/projects/happier'],
            },
        };

        const { listRecentPathsForVoiceTool } = await import('./pathsListRecent');

        const result: any = await listRecentPathsForVoiceTool({ limit: 10 });

        expect(result.items).toEqual([
            {
                label: 'happier — Replacement Machine',
                lastUsedAt: 1000,
            },
        ]);
    });
});
