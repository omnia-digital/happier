import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage, useLocalSettingMutable } from '@/sync/domains/state/storage';
import { localSettingsParse } from '@/sync/domains/settings/localSettings';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { machineScmStatusSnapshot } from '@/sync/ops/scm/machineScm';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { useSessionRepositoryView } from './useSessionRepositoryView';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';

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
function useView(source = items) {
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
