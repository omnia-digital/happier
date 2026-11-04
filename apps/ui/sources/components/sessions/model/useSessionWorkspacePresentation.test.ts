import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storageStore';

import { useSessionWorkspacePresentation } from './useSessionWorkspacePresentation';

const initialState = storage.getState();

describe('useSessionWorkspacePresentation', () => {
    afterEach(() => {
        standardCleanup();
        storage.setState(initialState, true);
        vi.restoreAllMocks();
    });

    it('gives the header the same identity as the row once a repository is stored', async () => {
        const scope = { serverId: 'server-a', accountId: 'account-a' };
        const path = '/Users/tester/.worktrees/generated-17';
        const metadata = { ...createSessionFixture().metadata!, machineId: 'machine-1', path, homeDir: '/Users/tester' };
        storage.setState({ profileScope: scope });

        const hook = await renderHook(() => useSessionWorkspacePresentation({ metadata }));
        expect(hook.getCurrent()?.identityLabel).toBe('generated-17');

        await act(async () => {
            storage.setState(state => ({ localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: {
                [repositoryWorkspaceKey({ ...scope, machineId: 'machine-1', path })]: {
                    identity: 'github.com/acme/repo', label: 'github.com/acme/repo', rootPath: path, worktreePaths: [],
                },
            } } }));
        });
        expect(hook.getCurrent()?.identityLabel).toBe('repo');
    });

    it('does not re-render the session screen for an account the active Home already knows', async () => {
        const metadata = { ...createSessionFixture().metadata!, machineId: 'machine-1', path: '/Users/tester/app', homeDir: '/Users/tester' };
        storage.setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
        let renders = 0;

        await renderHook(() => { renders += 1; return useSessionWorkspacePresentation({ serverId: 'server-a', metadata }); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(renders).toBe(1);
    });

    it('gives a foreign Home header the identity stored under that Home\'s account', async () => {
        const home = upsertServerProfile({ serverUrl: 'https://workspace-presentation-foreign.test', name: 'Foreign Home' });
        const foreignScope = { serverId: home.id, accountId: 'foreign-account' };
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
            token: `e30.${btoa(JSON.stringify({ sub: foreignScope.accountId }))}.signature`,
        });
        const path = '/Users/tester/.worktrees/generated-17';
        const metadata = { ...createSessionFixture().metadata!, machineId: 'machine-1', path, homeDir: '/Users/tester' };
        storage.setState(state => ({
            profileScope: { serverId: 'server-a', accountId: 'account-a' },
            localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: {
                [repositoryWorkspaceKey({ ...foreignScope, machineId: 'machine-1', path })]: {
                    identity: 'github.com/acme/repo', label: 'github.com/acme/repo', rootPath: path, worktreePaths: [],
                },
            } },
        }));

        const hook = await renderHook(() => useSessionWorkspacePresentation({ serverId: home.id, metadata }));

        await vi.waitFor(() => expect(hook.getCurrent()?.identityLabel).toBe('repo'));
    });
});
