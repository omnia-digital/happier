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
import { buildSessionListIndexFromViewData } from '@/sync/domains/session/listing/sessionListIndex';
import { buildSessionListTreeRows } from '../drop-resolution/buildSessionListTreeRows';
import { buildSessionListDragSource } from '../drop-resolution/buildSessionListDragSource';
import { resolveSessionListInstruction } from '../drop-resolution/resolveSessionListInstruction';
import { treeRowId } from '../drop-resolution/treeRowId';
import { buildSessionListKeyboardMoveResult } from '../move-sheet/buildSessionListKeyboardMoveResult';
import { applySessionListTreeDropOperation } from '../commit/applySessionListTreeDropOperation';
import { projectSessionListFlatView } from './projectSessionListFlatView';

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
    it('rejects an unpersistable cross-Home flat order while admitting a same-Home move in the mixed band', async () => {
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Active', headerKind: 'active' },
            { type: 'header', title: 'A', headerKind: 'project', groupKey: 'project-a', serverId: 'home-a' },
            { ...first, serverId: 'home-a', workspace: { ...first.workspace!, serverId: 'home-a' }, session: { ...first.session, id: 'a' }, groupKey: 'project-a', groupKind: 'project' },
            { type: 'header', title: 'B', headerKind: 'project', groupKey: 'project-b', serverId: 'home-b' },
            ...['b1', 'b2'].map(id => ({ ...first, serverId: 'home-b', workspace: { ...first.workspace!, serverId: 'home-b' }, session: { ...first.session, id }, groupKey: 'project-b', groupKind: 'project' as const })),
        ];
        const projected = projectSessionListFlatView({ items: source });
        const tree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(projected)!, rowBoundsById: new Map([
            [treeRowId.session('home-a', 'a'), { x: 0, y: 0, width: 320, height: 40 }],
            [treeRowId.session('home-b', 'b1'), { x: 0, y: 40, width: 320, height: 40 }],
            [treeRowId.session('home-b', 'b2'), { x: 0, y: 80, width: 320, height: 40 }],
        ]) });
        const b1 = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('home-b', 'b1') });
        const b2 = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('home-b', 'b2') });
        expect(resolveSessionListInstruction({ tree, source: b1, pointer: { x: 20, y: 10 }, foldersFeatureEnabled: true }).instruction.kind).toBe('blocked');
        expect(resolveSessionListInstruction({ tree, source: b2, pointer: { x: 20, y: 50 }, foldersFeatureEnabled: true }).instruction.kind).toBe('reorder-before');
        expect(buildSessionListKeyboardMoveResult({ tree, source: b1, direction: 'up' }).instruction.kind).toBe('blocked');
        const valid = buildSessionListKeyboardMoveResult({ tree, source: b2, direction: 'up' });
        expect(valid.instruction.kind).toBe('reorder-before');
        const setOrder = vi.fn();
        const context = {
            sessionFoldersV1: { v: 1 as const, folders: [] }, sessionListGroupOrderV1: {}, now: () => 1,
            setSessionFoldersV1: vi.fn(), setSessionListGroupOrderV1: setOrder,
            setSessionFolderAssignment: vi.fn(async () => undefined),
        };
        const rawInvalid = { instruction: { kind: 'reorder-before' as const, targetId: treeRowId.session('home-a', 'a'),
            containerId: b1.metadata.containerId, parentId: null, depth: 0 }, visual: { kind: 'none' as const } };
        expect(await applySessionListTreeDropOperation({ tree, source: b1, result: rawInvalid, context })).toMatchObject({ ok: false });
        expect(setOrder).not.toHaveBeenCalled();
        expect(await applySessionListTreeDropOperation({ tree, source: b2, result: valid, context })).toMatchObject({ ok: true });
        expect(setOrder).toHaveBeenCalledWith(expect.objectContaining({ [b2.metadata.containerGroupKey]: ['home-a:a', 'home-b:b2', 'home-b:b1'] }));

        const reverseHomeOrder = projectSessionListFlatView({ items: [source[0]!, ...source.slice(3), ...source.slice(1, 3)] });
        const reverseTree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(reverseHomeOrder)! });
        const reverseB2 = buildSessionListDragSource({ tree: reverseTree, sourceRowId: treeRowId.session('home-b', 'b2') });
        expect(buildSessionListKeyboardMoveResult({ tree: reverseTree, source: reverseB2, direction: 'up' }).instruction.kind).toBe('reorder-before');
    });

    it('flattens derived project and date groups while sorting sessions within retained sections', async () => {
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Active', headerKind: 'active', serverId: scope.serverId },
            { type: 'header', title: 'Checkout A', headerKind: 'project', groupKey: 'project-a', serverId: scope.serverId },
            { ...first, session: { ...first.session, id: 'a', createdAt: 10 }, section: 'active', groupKey: 'project-a', groupKind: 'project' },
            { type: 'header', title: 'Checkout B', headerKind: 'project', groupKey: 'project-b', serverId: scope.serverId },
            { ...first, session: { ...first.session, id: 'b', createdAt: 20 }, section: 'active', groupKey: 'project-b', groupKind: 'project' },
            { ...first, session: { ...first.session, id: 'aa', createdAt: 20 }, section: 'active', groupKey: 'project-b', groupKind: 'project' },
            { type: 'header', title: 'Inactive', headerKind: 'inactive', serverId: scope.serverId },
            { type: 'header', title: 'Yesterday', headerKind: 'date', groupKey: 'date-a', serverId: scope.serverId },
            { ...first, session: { ...first.session, id: 'c', createdAt: 30 }, section: 'inactive', groupKey: 'date-a', groupKind: 'date' },
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: 'date-b', serverId: scope.serverId },
            { ...first, session: { ...first.session, id: 'd', createdAt: 40 }, section: 'inactive', groupKey: 'date-b', groupKind: 'date' },
        ];
        const hook = await renderHook(() => useSessionRepositoryView({ items: source, mode: 'flat', setMode: () => {}, onFailure, orderingMode: 'created' }));
        const projected = hook.getCurrent().items ?? [];
        expect(projected.filter(item => item.type === 'header').map(item => item.headerKind)).toEqual(['active', 'inactive']);
        expect(projected.filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['aa', 'b', 'a', 'd', 'c']);
        expect(projected.filter(item => item.type === 'session').every(item => item.workspace === first.workspace && item.serverId === scope.serverId)).toBe(true);
        expect(projected.filter(item => item.type === 'session').every(item => item.groupKind === 'flat' && item.variant === 'default')).toBe(true);
        expect(machineScmStatusSnapshot).not.toHaveBeenCalled();
    });

    it('keeps real folders and Home ownership while removing project grouping', async () => {
        const first = items[0];
        if (first.type !== 'session') throw new Error('Expected session');
        const foreignHome = upsertServerProfile({ serverUrl: 'https://flat-foreign-home.test', name: 'Flat foreign Home' });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token: `e30.${btoa(JSON.stringify({ sub: 'foreign-account' }))}.signature` });
        const foreignWorkspace = { t: 'workspaceScope' as const, serverId: foreignHome.id, machineId: 'foreign-machine', rootPath: '/foreign' };
        const source: SessionListViewItem[] = [
            { type: 'header', title: 'Pinned', headerKind: 'pinned', groupKey: 'pinned-v1' },
            { ...first, session: { ...first.session, id: 'pinned' }, groupKey: 'pinned-v1', groupKind: 'pinned', pinned: true },
            { type: 'header', title: 'Active', headerKind: 'active' },
            { type: 'header', title: 'First checkout', headerKind: 'project', groupKey: 'project-a', serverId: scope.serverId },
            { type: 'header', title: 'Real folder', headerKind: 'folder', groupKey: 'project-a:folder:folder-a', folderId: 'folder-a', depth: 0, serverId: scope.serverId, workspace: first.workspace },
            { ...first, session: { ...first.session, id: 'filed' }, groupKey: 'project-a:folder:folder-a', groupKind: 'folder', folderId: 'folder-a', folderDepth: 1 },
            { ...first, session: { ...first.session, id: 'local' }, section: 'active', groupKey: 'project-a', groupKind: 'project' },
            { type: 'header', title: 'Other checkout', headerKind: 'project', groupKey: 'project-b', serverId: foreignHome.id },
            { ...first, session: { ...first.session, id: 'foreign' }, serverId: foreignHome.id, workspace: foreignWorkspace, section: 'active', groupKey: 'project-b', groupKind: 'project' },
            { type: 'header', title: 'Shared', headerKind: 'shared', groupKey: 'shared-v1' },
            { ...first, session: { ...first.session, id: 'shared' }, groupKey: 'shared-v1', groupKind: 'shared' },
        ];
        const hook = await renderHook(() => useSessionRepositoryView({ items: source, mode: 'flat', setMode: () => {}, onFailure, orderingMode: 'custom', folderSortMode: 'mixed' }));
        const projected = hook.getCurrent().items ?? [];
        expect(projected.filter(item => item.type === 'header').map(item => item.headerKind)).toEqual(['pinned', 'active', 'folder', 'shared']);
        const rows = projected.filter((item): item is Extract<SessionListViewItem, { type: 'session' }> => item.type === 'session');
        expect(rows.map(item => item.session.id)).toEqual(['pinned', 'filed', 'local', 'foreign', 'shared']);
        expect(rows.find(item => item.session.id === 'filed')).toMatchObject({ folderId: 'folder-a', serverId: scope.serverId, workspace: first.workspace });
        expect(rows.find(item => item.session.id === 'foreign')).toMatchObject({ serverId: foreignHome.id, workspace: foreignWorkspace });
        const flatKey = rows.find(item => item.session.id === 'local')?.groupKey;
        expect(flatKey).toBeTruthy();
        expect(rows.find(item => item.session.id === 'foreign')?.groupKey).toBe(flatKey);
        await vi.waitFor(() => expect(hook.getCurrent().orderScopes[flatKey!]?.map(value => value.serverId).sort()).toEqual([foreignHome.id, scope.serverId].sort()));
        expect(rows.find(item => item.session.id === 'pinned')?.groupKey).toBe('pinned-v1');
        expect(rows.find(item => item.session.id === 'shared')?.groupKey).toBe('shared-v1');
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
