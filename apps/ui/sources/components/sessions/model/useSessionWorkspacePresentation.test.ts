import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { storage } from '@/sync/domains/state/storageStore';

import { useSessionWorkspacePresentation } from './useSessionWorkspacePresentation';

const initialState = storage.getState();

describe('useSessionWorkspacePresentation', () => {
    afterEach(() => {
        standardCleanup();
        storage.setState(initialState, true);
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
});
