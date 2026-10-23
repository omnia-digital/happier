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
afterEach(() => { standardCleanup(); storage.setState(previous, true); });

describe('Repository view intent lifecycle', () => {
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
