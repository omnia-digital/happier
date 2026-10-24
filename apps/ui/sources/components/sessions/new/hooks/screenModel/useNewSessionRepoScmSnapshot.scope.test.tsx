import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { renderHook, flushHookEffects } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { resolveNewSessionReviewCommentsScope } from '../../attachments/resolveNewSessionReviewCommentsScope';
import { useNewSessionRepoScmSnapshot } from './useNewSessionRepoScmSnapshot';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
const activeScope = { serverId: 'active-home', accountId: 'active-account' };
const foreignScope = { serverId: 'foreign-home', accountId: 'foreign-account' };
beforeEach(() => {
    rpc.mockReset();
    storage.setState({ profileScope: activeScope });
});

function makeSnapshot(partial?: Partial<ScmWorkingSnapshot>): ScmWorkingSnapshot {
    return {
        projectKey: 'machine-a:/repo',
        fetchedAt: 123,
        repo: {
            isRepo: true,
            rootPath: '/repo',
            backendId: 'git',
            mode: '.git',
            worktrees: [],
        },
        capabilities: {
            readStatus: true,
            readDiffFile: true,
            readDiffCommit: true,
            readLog: true,
            writeInclude: true,
            writeExclude: true,
            writeCommit: true,
            writeCommitPathSelection: true,
            writeCommitLineSelection: true,
            writeBackout: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            worktreeCreate: true,
            changeSetModel: 'index',
            supportedDiffAreas: ['included', 'pending', 'both'],
            operationLabels: undefined,
        },
        branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
        ...partial,
    };
}

describe('new-session SCM target scope through the real repository cache', () => {
    it('does not borrow the active Home cache and sends both stages to the captured foreign account', async () => {
        const machineId = 'scope-rpc-machine';
        rpc.mockResolvedValue({ success: true, snapshot: makeSnapshot({ branch: { head: 'active', upstream: null, ahead: 0, behind: 0, detached: false } }) });
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo', scope: activeScope });
        rpc.mockClear();
        rpc.mockImplementation(async (input) => input.method === RPC_METHODS.SCM_STATUS_SNAPSHOT
            ? { success: true, snapshot: makeSnapshot({ repo: { isRepo: true, rootPath: '/repo', worktrees: [{ path: '/repo', branch: 'foreign', isCurrent: true }] }, branch: { head: 'foreign', upstream: null, ahead: 0, behind: 0, detached: false } }) }
            : { success: true, worktrees: [{ path: '/repo', changeCount: 7, lastActivityAt: 123 }] });
        const input = { machineId, path: '/repo', scope: foreignScope };
        const hook = await renderHook(() => useNewSessionRepoScmSnapshot(input));
        await flushHookEffects();
        expect(hook.getCurrent()?.branch.head).toBe('foreign');
        expect(hook.getCurrent()?.repo.worktrees?.[0]?.changeCount).toBe(7);
        expect(rpc.mock.calls.map(([request]) => [request.serverId, request.accountId, request.method])).toEqual([
            ['foreign-home', 'foreign-account', RPC_METHODS.SCM_STATUS_SNAPSHOT],
            ['foreign-home', 'foreign-account', RPC_METHODS.SCM_WORKTREES_ENRICHMENT],
        ]);
        await hook.unmount();
    });

    it.each(['server', 'account', 'machine'] as const)('clears a retained checkout when the %s changes despite an identical path', async (changed) => {
        const machineId = `scope-retained-${changed}`;
        rpc.mockResolvedValue({ success: true, snapshot: makeSnapshot() });
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo', scope: activeScope });
        rpc.mockImplementation(() => new Promise(() => {}));
        const initialProps = { machineId, path: '/repo', scope: activeScope as ServerAccountScope | null };
        const hook = await renderHook((props: typeof initialProps) => useNewSessionRepoScmSnapshot(props), { initialProps });
        expect(hook.getCurrent()?.repo.rootPath).toBe('/repo');
        await hook.rerender({ ...initialProps,
            machineId: changed === 'machine' ? `${machineId}-other` : machineId,
            scope: changed === 'server' ? foreignScope : changed === 'account' ? { ...activeScope, accountId: 'replacement-account' } : activeScope,
        });
        expect(hook.getCurrent()).toBeNull();
        await hook.unmount();
    });

    it('ignores a previous account response after the target changes', async () => {
        const machineId = 'scope-late-response';
        rpc.mockResolvedValue({ success: true, snapshot: makeSnapshot({ branch: { head: 'foreign', upstream: null, ahead: 0, behind: 0, detached: false } }) });
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo', scope: foreignScope });
        let release!: (value: unknown) => void;
        rpc.mockImplementation((input) => input.serverId === activeScope.serverId
            ? new Promise(resolve => { release = resolve; })
            : Promise.resolve({ success: true, snapshot: makeSnapshot({ branch: { head: 'foreign', upstream: null, ahead: 0, behind: 0, detached: false } }) }));
        const initialProps = { machineId, path: '/repo', scope: activeScope };
        const hook = await renderHook((props: typeof initialProps) => useNewSessionRepoScmSnapshot(props), { initialProps });
        await hook.rerender({ ...initialProps, scope: foreignScope });
        expect(hook.getCurrent()?.branch.head).toBe('foreign');
        await act(async () => { release({ success: true, snapshot: makeSnapshot({ branch: { head: 'old-account', upstream: null, ahead: 0, behind: 0, detached: false } }) }); });
        await flushHookEffects();
        expect(hook.getCurrent()?.branch.head).toBe('foreign');
        await hook.unmount();
    });

    it('keeps review-comment workspace roots scoped to the captured Home and account', async () => {
        const machineId = 'scope-review-comments';
        rpc.mockResolvedValue({ success: true, snapshot: makeSnapshot({ repo: { isRepo: true, rootPath: '/repo' } }) });
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo/subdir', scope: activeScope });
        const input = { targetServerId: foreignScope.serverId, selectedMachineId: machineId, selectedPath: '/repo/subdir', scmScope: foreignScope };
        expect(resolveNewSessionReviewCommentsScope(input)?.rootPath).toBe('/repo/subdir');
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo/subdir', scope: foreignScope });
        expect(resolveNewSessionReviewCommentsScope(input)?.rootPath).toBe('/repo');
        expect(resolveNewSessionReviewCommentsScope({ ...input, scmScope: null })?.rootPath).toBe('/repo/subdir');
    });

    it('does not read or fetch an implicit active target while its account binding is unresolved', async () => {
        const machineId = 'scope-unresolved';
        rpc.mockResolvedValue({ success: true, snapshot: makeSnapshot() });
        await scmRepositoryService.fetchSnapshotForMachinePath({ machineId, path: '/repo', scope: activeScope });
        rpc.mockClear();
        const input = { machineId, path: '/repo', scope: null };
        const hook = await renderHook(() => useNewSessionRepoScmSnapshot(input));
        expect(hook.getCurrent()).toBeNull();
        expect(rpc).not.toHaveBeenCalled();
        await hook.unmount();
    });
});
