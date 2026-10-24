import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { storage } from '@/sync/domains/state/storage';
import { materializeNewSessionCheckout } from './materializeNewSessionCheckout';
import { repoScmWorktreeService } from '@/scm/repository/repoScmWorktreeService';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const scope = { serverId: 'foreign-home', accountId: 'foreign-account' };
beforeEach(() => {
    rpc.mockReset();
    storage.setState({ profileScope: { serverId: 'active-home', accountId: 'viewer' }, machines: {
        machine: { id: 'machine', metadata: { homeDir: '/active-account-home' } } as never,
    } });
});

describe('worktree operations retain the captured machine account', () => {
    it('materializes a foreign checkout through the real worktree service and scoped RPC without borrowing the active home directory', async () => {
        rpc.mockResolvedValue({ success: true, worktreePath: '/foreign-home/repo/.worktrees/task', branchName: 'task',
            sourceRootPath: '/foreign-home/repo', repositoryRootPath: '/foreign-home/repo' });
        const input = { scope, machineId: 'machine', selectedPath: '~/repo', checkoutCreationDraft: { kind: 'git_worktree' as const, displayName: 'task', baseRef: 'main' } };
        const result = await materializeNewSessionCheckout(input);
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
            ...scope, machineId: 'machine', method: RPC_METHODS.SCM_WORKTREE_CREATE,
            payload: expect.objectContaining({ cwd: '~/repo', displayName: 'task', baseRef: 'main' }),
        }));
        expect(result).toMatchObject({ success: true, sessionPath: '/foreign-home/repo/.worktrees/task' });
    });

    it('requires a verified account only when creating a worktree', async () => {
        rpc.mockResolvedValue({ success: true, worktreePath: '/wrong-home/task', branchName: 'task' });
        const noCheckout = await materializeNewSessionCheckout({ machineId: 'machine', selectedPath: '/repo' });
        expect(noCheckout).toMatchObject({ success: true, sessionPath: '/repo' });
        const worktree = await materializeNewSessionCheckout({ machineId: 'machine', selectedPath: '/repo', checkoutCreationDraft: { kind: 'git_worktree', displayName: 'task', baseRef: null } });
        expect(worktree).toMatchObject({ success: false });
        expect(rpc).not.toHaveBeenCalled();
    });

    it.each(['remove', 'prune'] as const)('keeps %s on the supplied account through the shared worktree transport', async (operation) => {
        rpc.mockResolvedValue({ success: true, stdout: '', stderr: '' });
        const input = { scope, machineId: 'machine', path: '~/repo', worktreePath: '/foreign-home/repo/.worktrees/task' };
        if (operation === 'remove') await repoScmWorktreeService.removeWorktreeForMachinePath(input);
        else await repoScmWorktreeService.pruneWorktreesForMachinePath(input);
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
            ...scope, machineId: 'machine', method: operation === 'remove' ? RPC_METHODS.SCM_WORKTREE_REMOVE : RPC_METHODS.SCM_WORKTREE_PRUNE,
            payload: expect.objectContaining({ cwd: '~/repo' }),
        }));
    });
});
