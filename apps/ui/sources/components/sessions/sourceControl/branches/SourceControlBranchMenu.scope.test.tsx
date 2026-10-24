import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { installSourceControlBranchMenuCommonModuleMocks, resetSourceControlBranchMenuCommonModuleMockState,
    sourceControlBranchMenuModuleState as boundary, openSourceControlBranchMenu } from './sourceControlBranchMenuTestHelpers';

installSourceControlBranchMenuCommonModuleMocks();
vi.doUnmock('@/scm/repository/repoScmWorktreeService');
vi.doUnmock('@/sync/ops/sessionMachineTarget');
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));

let homeId: string;
let account: string;
beforeEach(async () => {
    resetSourceControlBranchMenuCommonModuleMockState();
    rpc.mockReset();
    const { storage } = await import('@/sync/domains/state/storage');
    const { upsertServerProfile } = await import('@/sync/domains/server/serverProfiles');
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    homeId = upsertServerProfile({ serverUrl: 'https://worktree-foreign.example.test', name: 'Foreign Home' }).id;
    account = 'foreign-account';
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockClear().mockImplementation(async () => ({ token: `e30.${btoa(JSON.stringify({ sub: account }))}.signature` }));
    storage.setState({ profileScope: { serverId: 'active-home', accountId: 'viewer' }, sessions: {
        s1: createSessionFixture({ id: 's1', serverId: homeId, active: true,
            metadata: { machineId: 'machine-foreign', path: '/foreign/repo/packages/app' } as never }),
    } });
});

async function renderMenu(open = true) {
    const { SourceControlBranchMenu } = await import('./SourceControlBranchMenu');
    const screen = await renderScreen(<SourceControlBranchMenu sessionId="s1" currentBranch="main" snapshot={{
        repo: { isRepo: true, rootPath: '/foreign/repo', worktrees: [] },
        capabilities: { worktreeCreate: true }, branch: { head: 'main' }, entries: [],
    } as never} />);
    if (open) await openSourceControlBranchMenu(screen);
    return screen.findByType('DropdownMenu' as never);
}

describe('branch menu captured worktree scope', () => {
    it('does not resolve credentials or issue RPCs while the menu is unopened', async () => {
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await renderMenu(false);
        expect(TokenStorage.getCredentialsForServerUrl).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('creates on the session owning Home and opens its new-session route through the real worktree service', async () => {
        rpc.mockResolvedValue({ success: true, worktreePath: '/foreign/worktrees/task', sourceRootPath: '/foreign/repo', branchName: 'task' });
        const menu = await renderMenu();
        expect(menu.props.items.find((item: {id: string}) => item.id === 'worktree:create-current-branch')?.disabled).toBe(false);
        await act(async () => { await menu.props.onSelect('worktree:create-current-branch'); });
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ serverId: homeId, accountId: 'foreign-account',
            machineId: 'machine-foreign', method: RPC_METHODS.SCM_WORKTREE_CREATE,
            payload: expect.objectContaining({ cwd: '/foreign/repo/packages/app' }),
        }));
        expect(boundary.routerPushSpy).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({
            spawnServerId: homeId, machineId: 'machine-foreign', directory: '/foreign/worktrees/task/packages/app',
        }) }));
    });

    it('does not open an old-account worktree result under a replacement foreign account', async () => {
        rpc.mockImplementation(async () => {
            account = 'replacement';
            return { success: true, worktreePath: '/old-account/task', sourceRootPath: '/foreign/repo', branchName: 'task' };
        });
        const menu = await renderMenu();
        await act(async () => { await menu.props.onSelect('worktree:create-current-branch'); });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(boundary.routerPushSpy).not.toHaveBeenCalled();
    });

    it('keeps the captured account while a remove confirmation is open', async () => {
        boundary.modalConfirmSpy.mockImplementation(async () => { account = 'replacement'; return true; });
        rpc.mockResolvedValue({ success: true });
        const menu = await renderMenu();
        await act(async () => { await menu.props.onSelect('worktree:remove:/foreign/worktrees/task'); });
        // The transport owns rejection of stale account credentials; the UI must not retarget.
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ serverId: homeId, accountId: 'foreign-account',
            method: RPC_METHODS.SCM_WORKTREE_REMOVE }));
    });

    it('routes another-branch creation to the owning Home without a machine RPC', async () => {
        const menu = await renderMenu();
        await act(async () => { await menu.props.onSelect('worktree:create-from-another-branch'); });
        expect(rpc).not.toHaveBeenCalled();
        expect(boundary.routerPushSpy).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({
            spawnServerId: homeId, machineId: 'machine-foreign', worktree: 'new', directory: '/foreign/repo/packages/app',
        }) }));
    });
});
