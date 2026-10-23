import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

let viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
const settingsState: Record<string, any> = {
    machinePathPreferencesByTargetV1: {},
    favoriteDirectories: ['/legacy/unassigned'],
};
const applySettingsMock = vi.fn();

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useActiveServerAccountScope: () => viewerScope,
        useSetting: (key: string) => settingsState[key],
        storage: { getState: () => ({ settings: settingsState }) },
    });
});
vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettingsMock,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => viewerScope,
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: (left: string, right: string) =>
        left === right || (left === 'target-alias' && right === 'target-server')
            || (left === 'target-server' && right === 'target-alias'),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext', () => ({
    resolveServerScopedSessionContext: async () => ({
        scope: 'scoped',
        targetServerId: 'target-server',
        targetAccountId: 'target-a',
    }),
    isServerScopedSessionContextCurrent: async () => true,
}));

describe('useMachinePathTargetScope', () => {
    it('hides a prior foreign target immediately when the viewer account changes', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        const { useMachinePathTargetScope } = await import('./useMachinePathPreferences');
        let targetAccountId: string | null = null;
        const renderedAccounts: Array<string | null> = [];
        const Probe = () => {
            targetAccountId = useMachinePathTargetScope('target-server')?.scope.accountId ?? null;
            renderedAccounts.push(targetAccountId);
            return null;
        };
        const screen = await renderScreen(<Probe />);
        await act(async () => { await Promise.resolve(); });
        expect(targetAccountId).toBe('target-a');

        const rendersBeforeSwitch = renderedAccounts.length;
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-b' };
        await act(async () => screen.tree.update(<Probe />));
        expect(renderedAccounts[rendersBeforeSwitch]).toBeNull();
        act(() => screen.tree.unmount());
    });

    it('uses the canonical server identity returned for a foreign Home alias', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        const { useMachinePathTargetScope } = await import('./useMachinePathPreferences');
        let targetServerId: string | null = null;
        const Probe = () => {
            targetServerId = useMachinePathTargetScope('target-alias')?.scope.serverId ?? null;
            return null;
        };
        const screen = await renderScreen(<Probe />);
        await act(async () => { await Promise.resolve(); });
        expect(targetServerId).toBe('target-server');
        act(() => screen.tree.unmount());
    });

    it('rejects a saved favorite handler from an earlier viewer account after rebinding', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        applySettingsMock.mockClear();
        const { useMachinePathPreferences } = await import('./useMachinePathPreferences');
        let toggleFavorite: ((path: string) => Promise<void>) | null = null;
        const Probe = () => {
            toggleFavorite = useMachinePathPreferences({
                serverId: 'target-server',
                machineId: 'machine-a',
                machines: [{ id: 'machine-a' }],
                machineHomeDir: '/home/target',
            }).toggleFavorite;
            return null;
        };
        const screen = await renderScreen(<Probe />);
        await act(async () => { await Promise.resolve(); });
        const oldToggleFavorite = toggleFavorite!;
        await act(async () => { await oldToggleFavorite('/home/target/repo'); });
        expect(applySettingsMock).toHaveBeenCalledWith({
            machinePathPreferencesByTargetV1: {
                [JSON.stringify(['target-server', 'target-a', 'machine-a'])]: {
                    favorites: ['/home/target/repo'],
                    recentPaths: [],
                },
            },
        });
        applySettingsMock.mockClear();

        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-b' };
        await act(async () => screen.tree.update(<Probe />));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await oldToggleFavorite('/home/target/repo'); });

        expect(applySettingsMock).not.toHaveBeenCalled();
        act(() => screen.tree.unmount());
    });
});
