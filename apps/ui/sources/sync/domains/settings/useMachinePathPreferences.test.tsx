import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

let viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
let settingsScope = viewerScope;
const credentialsForTarget = vi.fn();
const createEncryption = vi.fn(async (_credentials: unknown) => ({}));
const tokenForSub = (sub: string) => `e30.${globalThis.btoa(JSON.stringify({ sub })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.signature`;
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
        storage: { getState: () => ({ settings: settingsState, settingsScope }) },
    });
});
vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettingsMock,
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => viewerScope,
}));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createServerProfilesModuleMock({
        importOriginal,
        overrides: {
            listServerProfiles: () => [{
                id: 'target-alias',
                serverIdentityId: 'target-server',
                serverUrl: 'https://target.example.test',
                name: 'Target',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 1,
            }],
        },
    });
});
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'viewer-server', serverUrl: 'https://viewer.example.test' }),
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: { getCredentialsForServerUrl: (...args: unknown[]) => credentialsForTarget(...args) },
}));
vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: (credentials: unknown) => createEncryption(credentials),
}));

describe('useMachinePathTargetScope', () => {
    it('hides a prior foreign target immediately when the viewer account changes', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        settingsScope = viewerScope;
        credentialsForTarget.mockReset().mockResolvedValue({ token: tokenForSub('target-a'), secret: 'secret' });
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
        settingsScope = viewerScope;
        await act(async () => screen.tree.update(<Probe />));
        expect(renderedAccounts[rendersBeforeSwitch]).toBeNull();
        act(() => screen.tree.unmount());
    });

    it('uses the canonical server identity returned for a foreign Home alias', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        settingsScope = viewerScope;
        credentialsForTarget.mockReset().mockResolvedValue({ token: tokenForSub('target-a'), secret: 'secret' });
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
        settingsScope = viewerScope;
        credentialsForTarget.mockReset().mockResolvedValue({ token: tokenForSub('target-a'), secret: 'secret' });
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
        settingsScope = viewerScope;
        await act(async () => screen.tree.update(<Probe />));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await oldToggleFavorite('/home/target/repo'); });

        expect(applySettingsMock).not.toHaveBeenCalled();
        act(() => screen.tree.unmount());
    });

    it('does not write a foreign favorite when the viewer changes during credential revalidation', async () => {
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-a' };
        settingsScope = viewerScope;
        applySettingsMock.mockClear();
        credentialsForTarget.mockReset().mockResolvedValue({ token: tokenForSub('target-a'), secret: 'secret' });
        const { useMachinePathPreferences } = await import('./useMachinePathPreferences');
        let toggleFavorite: ((path: string) => Promise<void>) | null = null;
        const Probe = () => {
            toggleFavorite = useMachinePathPreferences({
                serverId: 'target-server',
                machineId: 'machine-a',
                machines: [{ id: 'machine-a' }],
            }).toggleFavorite;
            return null;
        };
        const screen = await renderScreen(<Probe />);
        await act(async () => { await Promise.resolve(); });
        expect(toggleFavorite).not.toBeNull();

        let releaseCredentials!: (credentials: { token: string; secret: string }) => void;
        credentialsForTarget.mockImplementationOnce(() => new Promise((resolve) => {
            releaseCredentials = resolve;
        }));
        const pending = toggleFavorite!('/repo');
        viewerScope = { serverId: 'viewer-server', accountId: 'viewer-b' };
        settingsScope = viewerScope;
        await act(async () => screen.tree.update(<Probe />));
        releaseCredentials({ token: tokenForSub('target-a'), secret: 'secret' });
        await act(async () => { await pending; });

        expect(applySettingsMock).not.toHaveBeenCalled();
        act(() => screen.tree.unmount());
    });
});
