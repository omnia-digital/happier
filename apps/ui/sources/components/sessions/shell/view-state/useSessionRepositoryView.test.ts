import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage, useLocalSettingMutable } from '@/sync/domains/state/storage';
import { localSettingsParse } from '@/sync/domains/settings/localSettings';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { machineScmStatusSnapshot } from '@/sync/ops/scm/machineScm';
import { readRepositoryAssociation, repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { useSessionRepositoryView } from './useSessionRepositoryView';
import { discoverSessionRepositories } from './sessionRepositoryDiscovery';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { createScmCapabilities, type ScmStatusSnapshotResponse, type ScmWorkingSnapshot } from '@happier-dev/protocol';

vi.mock('@/sync/ops/scm/machineScm', () => ({ machineScmStatusSnapshot: vi.fn(), machineScmWorktreesEnrichment: vi.fn() }));
vi.mock('@/sync/ops', () => ({ sessionScmStatusSnapshot: vi.fn() }));
const scope = { serverId: 'repository-hook-home', accountId: 'account' };
const workspace = { ...scope, machineId: 'hook-machine', path: '/repo' };
const items: SessionListViewItem[] = [{ type: 'session', serverId: scope.serverId,
    workspace: { t: 'workspaceScope', serverId: scope.serverId, machineId: workspace.machineId, rootPath: workspace.path },
    session: { id: 'session', createdAt: 1, updatedAt: 1, metadata: { machineId: workspace.machineId, path: workspace.path } } as any }];
const onFailure = vi.fn();
const snapshot = { projectKey: 'hook-repo', fetchedAt: 1, repo: { isRepo: true, rootPath: '/repo', remotes: [{ name: 'origin', fetchUrl: 'git@example.com:team/repo.git' }] },
    branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false }, entries: [], hasConflicts: false, stashCount: 0,
    totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 } };
function discoverySnapshot(worktrees: readonly string[]): ScmWorkingSnapshot {
    return {
        projectKey: 'hook-repo', fetchedAt: 1,
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git',
            remotes: [{ name: 'origin', fetchUrl: 'git@example.com:team/repo.git' }],
            worktrees: worktrees.map(path => ({ path, branch: 'main', isCurrent: false })) },
        capabilities: createScmCapabilities({ readStatus: true }),
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        stashCount: 0, hasConflicts: false, entries: [],
        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
    };
}
function useView(source: SessionListViewItem[] | null = items) {
    const [mode, setMode] = useLocalSettingMutable('sessionListMachineViewV1');
    return useSessionRepositoryView({ items: source, mode, setMode, onFailure });
}
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ profileScope: scope, localSettings: { ...localSettingsParse(null), sessionListMachineViewV1: 'repository' } });
    vi.mocked(machineScmStatusSnapshot).mockReset(); onFailure.mockReset();
});
afterEach(() => { standardCleanup(); storage.setState(previous, true); vi.restoreAllMocks(); });

describe('Repository view intent lifecycle', () => {
    it('associates the exact nested session path while inheriting a manual choice from its discovered repository', async () => {
        const machineId = 'nested-manual-machine';
        const sessionPath = '/repo/.dev/worktree/manual/packages/app';
        const rootKey = repositoryWorkspaceKey({ ...scope, machineId, path: '/repo' });
        storage.setState(state => ({ localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: {
            [rootKey]: { identity: 'example.com/team/repo', label: 'example.com/team/repo', rootPath: '/repo', worktreePaths: [],
                manual: { identity: 'example.com/team/my-project', label: 'My Project' } },
        } } }));
        vi.mocked(machineScmStatusSnapshot).mockResolvedValue({ success: true,
            snapshot: discoverySnapshot(['/repo/.dev/worktree/manual']) });
        expect(await discoverSessionRepositories({
            workspaces: [{ serverId: scope.serverId, machineId, path: sessionPath }],
            verifyNewWorkspace: true, isCurrent: () => true,
        })).toEqual([]);
        expect(machineScmStatusSnapshot).toHaveBeenCalledWith(machineId, { cwd: sessionPath }, scope);
        expect(readRepositoryAssociation(storage.getState().localSettings.sessionRepositoryAssociationsV1,
            { ...scope, machineId, path: sessionPath })).toMatchObject({
            identity: 'example.com/team/repo',
            manual: { identity: 'example.com/team/my-project', label: 'My Project' },
        });
    });

    it('discovers new workspaces arriving during an in-flight discovery without changing their execution paths', async () => {
        const firstPath = '/repo/.dev/worktree/first';
        const secondPath = '/repo/.dev/worktree/second';
        const arrivalWorkspace = { ...workspace, machineId: 'arrival-hook-machine' };
        let finishFirst!: (value: ScmStatusSnapshotResponse) => void;
        const firstResponse = new Promise<ScmStatusSnapshotResponse>(resolve => { finishFirst = resolve; });
        vi.mocked(machineScmStatusSnapshot).mockImplementation(async (_machine, request) => {
            if (request.cwd === firstPath) return await firstResponse;
            if (request.cwd === secondPath) return { success: true, snapshot: discoverySnapshot([firstPath, secondPath]) };
            throw new Error(`Unexpected discovery path ${request.cwd}`);
        });
        const sourceItem = items[0];
        if (sourceItem.type !== 'session') throw new Error('Expected session');
        const firstItem = { ...sourceItem,
            workspace: { t: 'workspaceScope' as const, serverId: scope.serverId, machineId: arrivalWorkspace.machineId, rootPath: workspace.path },
            session: { ...sourceItem.session, metadata: { ...sourceItem.session.metadata, machineId: arrivalWorkspace.machineId } },
        };
        const hook = await renderHook<ReturnType<typeof useSessionRepositoryView>, SessionListViewItem[] | null>(source => useView(source), { initialProps: null });
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
        await hook.rerender([]);
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();

        const firstArrival: SessionListViewItem = { ...firstItem, session: { ...firstItem.session, id: 'first-arrival', metadata: { ...firstItem.session.metadata, path: firstPath } },
            workspace: { t: 'workspaceScope', serverId: scope.serverId, machineId: arrivalWorkspace.machineId, rootPath: firstPath } };
        await hook.rerender([firstArrival]);
        await vi.waitFor(() => expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1));
        // A newly represented Home changes the scope-read set while the first
        // workspace is in flight; its result must remain current.
        const otherHomeProfile = upsertServerProfile({ serverUrl: 'https://repository-arrival-other-home.test', name: 'Other Home' });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
            token: `e30.${btoa(JSON.stringify({ sub: 'other-account' }))}.signature`,
        });
        const otherHome: SessionListViewItem = { type: 'header', title: 'Other Home', headerKind: 'server', serverId: otherHomeProfile.id };
        await hook.rerender([otherHome, firstArrival]);

        const secondArrival: SessionListViewItem = { ...firstItem, session: { ...firstItem.session, id: 'second-arrival', metadata: { ...firstItem.session.metadata, path: secondPath } },
            workspace: { t: 'workspaceScope', serverId: scope.serverId, machineId: arrivalWorkspace.machineId, rootPath: secondPath } };
        await hook.rerender([otherHome, firstArrival, secondArrival]);
        await act(async () => { finishFirst({ success: true, snapshot: discoverySnapshot([firstPath]) }); });
        await vi.waitFor(() => expect(hook.getCurrent().refreshing).toBe(false));
        expect(onFailure).not.toHaveBeenCalled();

        await vi.waitFor(() => {
            const associations = storage.getState().localSettings.sessionRepositoryAssociationsV1;
            expect(readRepositoryAssociation(associations, { ...arrivalWorkspace, path: firstPath })?.identity).toBe('example.com/team/repo');
            expect(readRepositoryAssociation(associations, { ...arrivalWorkspace, path: secondPath })?.identity).toBe('example.com/team/repo');
        });
        const repositoryHeader = hook.getCurrent().items?.find(item => item.type === 'header' && item.repository?.identity === 'example.com/team/repo');
        expect(repositoryHeader?.type).toBe('header');
        if (repositoryHeader?.type !== 'header') throw new Error('Expected repository header');
        expect(repositoryHeader.repository?.checkouts.map(checkout => checkout.path).sort()).toEqual([firstPath, secondPath].sort());
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(2);
        expect(machineScmStatusSnapshot).toHaveBeenCalledWith(arrivalWorkspace.machineId, { cwd: firstPath }, scope);
        expect(machineScmStatusSnapshot).toHaveBeenCalledWith(arrivalWorkspace.machineId, { cwd: secondPath }, scope);
        const secondSession = hook.getCurrent().items?.find(item => item.type === 'session' && item.session.id === 'second-arrival');
        expect(secondSession?.type).toBe('session');
        if (secondSession?.type !== 'session') throw new Error('Expected arrived session');
        expect(secondSession.workspace?.t === 'workspaceScope' ? secondSession.workspace.rootPath : null).toBe(secondPath);
    });

    it('rebinds foreign associations and cancels discovery when that Home changes account', async () => {
        const home = upsertServerProfile({ serverUrl: 'https://repository-foreign-account.test', name: 'Repository foreign account' });
        let accountId = 'foreign-a';
        const credentialListeners = new Set<() => void>();
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async () => ({
            token: `e30.${btoa(JSON.stringify({ sub: accountId }))}.signature`,
        }));
        vi.spyOn(TokenStorage, 'subscribeCredentialChanges').mockImplementation(listener => {
            credentialListeners.add(listener);
            return () => { credentialListeners.delete(listener); };
        });
        const foreignWorkspace = { serverId: home.id, accountId, machineId: 'foreign-machine', path: '/foreign-repo' };
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const source: SessionListViewItem[] = [{ ...first, serverId: home.id,
            workspace: { t: 'workspaceScope', serverId: home.id, machineId: foreignWorkspace.machineId, rootPath: foreignWorkspace.path },
            session: { ...first.session, metadata: { machineId: foreignWorkspace.machineId, path: foreignWorkspace.path } },
        }];
        const associations = Object.fromEntries(['foreign-a', 'foreign-b'].map(owner => [
            repositoryWorkspaceKey({ ...foreignWorkspace, accountId: owner }),
            { identity: `example.com/${owner}/repo`, label: owner, rootPath: foreignWorkspace.path, worktreePaths: [] },
        ]));
        storage.setState(state => ({ localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: associations } }));
        const hook = await renderHook(() => useView(source));
        await vi.waitFor(() => expect(hook.getCurrent().scopes[home.id]?.accountId).toBe('foreign-a'));
        expect(hook.getCurrent().items?.some(item => item.type === 'header' && item.title === 'foreign-a')).toBe(true);
        let finish!: (value: any) => void;
        vi.mocked(machineScmStatusSnapshot).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        let pending!: Promise<void>;
        await act(async () => { pending = hook.getCurrent().refresh(); });
        await vi.waitFor(() => expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1));
        await act(async () => {
            accountId = 'foreign-b';
            for (const listener of credentialListeners) listener();
        });
        await vi.waitFor(() => expect(hook.getCurrent().scopes[home.id]?.accountId).toBe('foreign-b'));
        expect(hook.getCurrent().items?.some(item => item.type === 'header' && item.title === 'foreign-a')).toBe(false);
        expect(hook.getCurrent().items?.some(item => item.type === 'header' && item.title === 'foreign-b')).toBe(true);
        await act(async () => { finish({ success: true, snapshot }); await pending; });
        expect(storage.getState().localSettings.sessionRepositoryAssociationsV1).toBe(associations);
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().refreshing).toBe(false);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('ignores a superseded local account read without discovering repositories on credential changes', async () => {
        const home = upsertServerProfile({ serverUrl: 'https://repository-delayed-account.test', name: 'Delayed repository account' });
        const token = (accountId: string) => ({ token: `e30.${btoa(JSON.stringify({ sub: accountId }))}.signature` });
        let finishOldRead!: (value: ReturnType<typeof token>) => void;
        const read = vi.spyOn(TokenStorage, 'getCredentialsForServerUrl')
            .mockReturnValueOnce(new Promise(resolve => { finishOldRead = resolve; }))
            .mockResolvedValue(token('foreign-b'));
        const listeners = new Set<() => void>();
        vi.spyOn(TokenStorage, 'subscribeCredentialChanges').mockImplementation(listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        });
        const source = items.map(item => ({ ...item, serverId: home.id }));
        const preferences = storage.getState().localSettings;
        const hook = await renderHook(() => useView(source));
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
        await act(async () => { for (const listener of listeners) listener(); });
        await vi.waitFor(() => expect(hook.getCurrent().scopes[home.id]?.accountId).toBe('foreign-b'));
        await act(async () => { finishOldRead(token('foreign-a')); });
        expect(hook.getCurrent().scopes[home.id]?.accountId).toBe('foreign-b');
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
        expect(storage.getState().localSettings).toBe(preferences);
        standardCleanup();
        expect(listeners.size).toBe(0);
    });

    it('does not discover a restored foreign workspace when its account scope resolves later', async () => {
        const home = upsertServerProfile({ serverUrl: 'https://repository-restored-foreign.test', name: 'Restored foreign Home' });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
            token: `e30.${btoa(JSON.stringify({ sub: 'restored-account' }))}.signature`,
        });
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const restored: SessionListViewItem = { ...first, serverId: home.id,
            workspace: { t: 'workspaceScope', serverId: home.id, machineId: 'restored-machine', rootPath: '/restored/repo' },
            session: { ...first.session, metadata: { machineId: 'restored-machine', path: '/restored/repo' } },
        };
        const hook = await renderHook<ReturnType<typeof useSessionRepositoryView>, SessionListViewItem[]>(source => useView(source), { initialProps: [restored] });
        await vi.waitFor(() => expect(hook.getCurrent().scopes[home.id]?.accountId).toBe('restored-account'));
        await hook.rerender([{ ...restored, session: { ...restored.session, updatedAt: 2 } }]);
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('discovers after selecting Repository from Original and retains the response after the mode transition', async () => {
        storage.setState(state => ({ localSettings: { ...state.localSettings, sessionListMachineViewV1: 'original' } }));
        let finish!: (value: any) => void;
        vi.mocked(machineScmStatusSnapshot).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const hook = await renderHook(useView);
        await act(async () => { hook.getCurrent().selectMode('repository'); });
        await vi.waitFor(() => expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1));
        await act(async () => { finish({ success: true, snapshot }); });
        await vi.waitFor(() => expect(storage.getState().localSettings.sessionRepositoryAssociationsV1[repositoryWorkspaceKey(workspace)]?.identity).toBe('example.com/team/repo'));
    });

    it('settles cached unresolved discovery after switching views without another RPC', async () => {
        const unresolvedSnapshot = { ...snapshot, repo: { ...snapshot.repo, remotes: [{ name: 'origin', fetchUrl: 'git@local-alias:team/repo.git' }] } };
        vi.mocked(machineScmStatusSnapshot).mockResolvedValue({ success: true, snapshot: unresolvedSnapshot } as any);
        const hook = await renderHook(useView);
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(hook.getCurrent().refreshing).toBe(false);
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        await act(async () => { hook.getCurrent().selectMode('original'); });
        await act(async () => { hook.getCurrent().selectMode('machine'); });
        await act(async () => { hook.getCurrent().selectMode('repository'); });
        await vi.waitFor(() => expect(hook.getCurrent().refreshing).toBe(false));
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('reacts to canonical organization hydration and preserves the order across view changes', async () => {
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const second = { ...first, session: { ...first.session, id: 'second' } };
        const source = [first, second];
        const associations = { [repositoryWorkspaceKey(workspace)]: { identity: 'example.com/team/repo', label: 'Known repository', rootPath: '/repo', worktreePaths: [] } };
        storage.setState(state => ({ localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: associations } }));
        const hook = await renderHook(() => useView(source));
        const groupKey = hook.getCurrent().items?.find(item => item.type === 'header' && item.repository)?.groupKey!;
        await act(async () => {
            const recordId = storage.getState().applySessionOrganizationOrderScopeOptimistic(scope.serverId, {
                scopeKind: 'group', scopeKey: groupKey, entries: ['session', 'second'].map((itemKey, index) => ({ scopeKind: 'group' as const, scopeKey: groupKey, itemKind: 'session' as const, itemKey, sortKey: String(index) })),
            });
            storage.getState().commitSessionOrganizationOptimistic(recordId);
        });
        expect(hook.getCurrent().items?.filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['session', 'second']);
        await act(async () => { hook.getCurrent().selectMode('machine'); });
        await act(async () => { hook.getCurrent().selectMode('repository'); });
        expect(hook.getCurrent().items?.filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['session', 'second']);
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
    });

    it('renders persisted associations on restore without RPC or a preference write, then refreshes on explicit intent', async () => {
        const associations = { [repositoryWorkspaceKey(workspace)]: { identity: 'example.com/team/repo', label: 'Known repository', rootPath: '/repo', worktreePaths: [] } };
        storage.setState(state => ({ localSettings: { ...state.localSettings, sessionRepositoryAssociationsV1: associations } }));
        const before = storage.getState().localSettings;
        const hook = await renderHook(useView);
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
        expect(storage.getState().localSettings).toBe(before);
        expect(hook.getCurrent().items?.some(item => item.type === 'header' && item.title === 'Known repository')).toBe(true);
        vi.mocked(machineScmStatusSnapshot).mockResolvedValue({ success: true, snapshot } as any);
        await act(async () => { await hook.getCurrent().refresh(); });
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('coalesces repeated explicit discovery and ignores a late response after changing views', async () => {
        let finish!: (value: any) => void;
        vi.mocked(machineScmStatusSnapshot).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const hook = await renderHook(useView);
        let pending!: Promise<void>;
        await act(async () => { pending = hook.getCurrent().refresh(); void hook.getCurrent().refresh(); });
        await vi.waitFor(() => expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1));
        await act(async () => { hook.getCurrent().selectMode('original'); });
        await act(async () => { finish({ success: true, snapshot }); await pending; });
        expect(storage.getState().localSettings.sessionRepositoryAssociationsV1).toEqual({});
        expect(storage.getState().localSettings.sessionListMachineViewV1).toBe('original');
        expect(hook.getCurrent().items).toBe(items);
    });
});
