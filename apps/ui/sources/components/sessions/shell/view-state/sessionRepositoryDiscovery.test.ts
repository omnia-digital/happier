import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { localSettingsParse } from '@/sync/domains/settings/localSettings';
import { machineScmStatusSnapshot } from '@/sync/ops/scm/machineScm';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { discoverSessionRepositories } from './sessionRepositoryDiscovery';

vi.mock('@/sync/ops/scm/machineScm', () => ({ machineScmStatusSnapshot: vi.fn(), machineScmWorktreesEnrichment: vi.fn() }));
vi.mock('@/sync/ops', () => ({ sessionScmStatusSnapshot: vi.fn() }));

const scope = { serverId: 'discovery-home', accountId: 'discovery-account' };
function snapshot(rootPath: string, worktrees: string[] = []) {
    return { projectKey: `machine:${rootPath}`, fetchedAt: 1,
        repo: { isRepo: true, rootPath, remotes: [{ name: 'origin', fetchUrl: 'git@example.com:team/repo.git' }], worktrees: worktrees.map(path => ({ path })) },
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false }, stashCount: 0, hasConflicts: false, entries: [],
        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
    };
}

beforeEach(() => {
    vi.mocked(machineScmStatusSnapshot).mockReset();
    storage.setState({ profileScope: scope, localSettings: localSettingsParse(null) });
});

describe('explicit repository discovery', () => {
    it('reuses the canonical cache, discovers distinct workspaces sequentially, and skips known worktree aliases', async () => {
        const first = { serverId: scope.serverId, machineId: 'cached', path: '/cached' };
        const second = { serverId: scope.serverId, machineId: 'second', path: '/repo' };
        vi.mocked(machineScmStatusSnapshot).mockImplementation(async (_machine, request) => ({ success: true, snapshot: snapshot(request.cwd!, ['/worktree']) }) as any);
        await scmRepositoryService.fetchSnapshotForMachinePath({ ...first, scope });
        vi.mocked(machineScmStatusSnapshot).mockClear();
        expect(await discoverSessionRepositories({ workspaces: [first, second, second, { ...second, path: '/worktree' }], isCurrent: () => true })).toEqual([]);
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        expect(machineScmStatusSnapshot).toHaveBeenCalledWith('second', { cwd: '/repo' }, scope);
        const associations = storage.getState().localSettings.sessionRepositoryAssociationsV1;
        expect(associations[repositoryWorkspaceKey({ ...scope, ...first })].identity).toBe('example.com/team/repo');
        expect(associations[repositoryWorkspaceKey({ ...scope, ...second })].worktreePaths).toContain('/worktree');
    });

    it('does not dispatch or persist after leaving the view, including a late result', async () => {
        let finish!: (value: any) => void;
        let current = true;
        vi.mocked(machineScmStatusSnapshot).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const pending = discoverSessionRepositories({ workspaces: [
            { serverId: scope.serverId, machineId: 'late', path: '/one' },
            { serverId: scope.serverId, machineId: 'late', path: '/two' },
        ], isCurrent: () => current });
        await vi.waitFor(() => expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1));
        current = false;
        finish({ success: true, snapshot: snapshot('/one') });
        expect(await pending).toEqual([]);
        expect(machineScmStatusSnapshot).toHaveBeenCalledTimes(1);
        expect(storage.getState().localSettings.sessionRepositoryAssociationsV1).toEqual({});
    });

    it('retains associations on failed refresh and returns the failure for visible retry feedback', async () => {
        const workspace = { ...scope, machineId: 'retry', path: '/retry' };
        const previous = { identity: 'example.com/team/repo', label: 'team/repo', rootPath: '/retry', worktreePaths: [] };
        storage.getState().applyLocalSettings({ sessionRepositoryAssociationsV1: { [repositoryWorkspaceKey(workspace)]: previous } });
        vi.mocked(machineScmStatusSnapshot).mockRejectedValue(new Error('machine offline'));
        const errors = await discoverSessionRepositories({ workspaces: [workspace], refresh: true, isCurrent: () => true });
        expect(errors).toHaveLength(1);
        expect(errors[0].workspace).toEqual(workspace);
        expect(storage.getState().localSettings.sessionRepositoryAssociationsV1[repositoryWorkspaceKey(workspace)]).toEqual(previous);
        vi.mocked(machineScmStatusSnapshot).mockResolvedValue({ success: true, snapshot: snapshot('/retry') } as any);
        expect(await discoverSessionRepositories({ workspaces: [workspace], refresh: true, isCurrent: () => true })).toEqual([]);
    });
});
