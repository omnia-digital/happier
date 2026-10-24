import { describe, expect, it, vi, afterEach } from 'vitest';

import { installRepositoryScmCommonModuleMocks } from './repositoryScmTestHelpers';
import { createPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';

const machineScmWorktreeCreateMock = vi.hoisted(() => vi.fn());
const machineScmWorktreePruneMock = vi.hoisted(() => vi.fn());
const machineScmWorktreeRemoveMock = vi.hoisted(() => vi.fn());
const storageGetStateMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('@/sync/ops/scm/machineScm', () => ({
    machineScmWorktreeCreate: (...args: unknown[]) => machineScmWorktreeCreateMock(...args),
    machineScmWorktreePrune: (...args: unknown[]) => machineScmWorktreePruneMock(...args),
    machineScmWorktreeRemove: (...args: unknown[]) => machineScmWorktreeRemoveMock(...args),
}));

installRepositoryScmCommonModuleMocks({
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        storage: {
            getState: storageGetStateMock,
        },
    }),
});

const scope = { serverId: 'home', accountId: 'account' };

describe('repoScmWorktreeService', () => {
    afterEach(() => {
        machineScmWorktreeCreateMock.mockReset();
        machineScmWorktreePruneMock.mockReset();
        machineScmWorktreeRemoveMock.mockReset();
        storageGetStateMock.mockReset();
        storageGetStateMock.mockReturnValue({});
    });

    it('finds a reusable sibling worktree for the selected base branch while ignoring the current worktree', async () => {
        const { findReusableRepoWorktreeForBranch } = await import('./repoScmWorktreeService');

        const result = findReusableRepoWorktreeForBranch({
            snapshot: {
                repo: {
                    isRepo: true,
                    rootPath: '/repo',
                    backendId: 'git',
                    mode: '.git',
                    worktrees: [
                        { path: '/repo', branch: 'main', isCurrent: true, isMain: true },
                        { path: '/repo/.worktrees/feature-auth', branch: 'feature/auth', isCurrent: false },
                    ],
                },
                branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                capabilities: {} as any,
                totals: {} as any,
                fetchedAt: 0,
                projectKey: 'project',
                hasConflicts: false,
                entries: [],
                stashCount: 0,
            } as any,
            selectedBaseRef: 'feature/auth',
            currentBranch: 'main',
            currentPath: '/repo/packages/app',
        });

        expect(result).toEqual({
            path: '/repo/.worktrees/feature-auth',
            branch: 'feature/auth',
            isCurrent: false,
        });
    });

    it('delegates repo-native worktree creation to the canonical machine SCM worktree RPC', async () => {
        machineScmWorktreeCreateMock.mockResolvedValue({
            success: true,
            worktreePath: '/repo/.dev/worktree/feature-auth',
            branchName: 'feature-auth',
            repositoryRootPath: '/repo',
            sourceRootPath: '/repo',
        });

        const { repoScmWorktreeService } = await import('./repoScmWorktreeService');
        const result = await repoScmWorktreeService.createWorktreeForMachinePath({
            scope,
            machineId: 'machine-1',
            path: '/repo/packages/app',
            baseRef: 'feature/auth',
        });

        expect(machineScmWorktreeCreateMock).toHaveBeenCalledWith(
            'machine-1',
            {
                cwd: '/repo/packages/app',
                baseRef: 'feature/auth',
                branchMode: 'new',
                displayName: expect.any(String),
            },
            scope,
        );
        expect(result.success).toBe(true);
    });

    it('forwards existing-branch worktree creation through the canonical machine SCM worktree RPC', async () => {
        machineScmWorktreeCreateMock.mockResolvedValue({
            success: true,
            worktreePath: '/repo/.dev/worktree/feature-auth',
            branchName: 'feature/auth',
            repositoryRootPath: '/repo',
            sourceRootPath: '/repo',
        });

        const { repoScmWorktreeService } = await import('./repoScmWorktreeService');
        const result = await repoScmWorktreeService.createWorktreeForMachinePath({
            scope,
            machineId: 'machine-1',
            path: '/repo/packages/app',
            displayName: 'feature/auth',
            branchMode: 'existing',
            launchNonce: 'launch-attempt-1',
        });

        expect(machineScmWorktreeCreateMock).toHaveBeenCalledWith(
            'machine-1',
            {
                cwd: '/repo/packages/app',
                displayName: 'feature/auth',
                branchMode: 'existing',
                launchNonce: 'launch-attempt-1',
            },
            scope,
        );
        expect(result.success).toBe(true);
    });

    it('resolves tilde machine paths to absolute paths using the machine homeDir before invoking the worktree RPC', async () => {
        storageGetStateMock.mockReturnValue({
            profileScope: scope,
            machines: {
                'machine-1': {
                    id: 'machine-1',
                    metadata: {
                        homeDir: '/Users/tester',
                    },
                },
            },
        } as any);
        machineScmWorktreeCreateMock.mockResolvedValue({
            success: true,
            worktreePath: '/Users/tester/repo/.dev/worktree/feature-auth',
            branchName: 'feature-auth',
            repositoryRootPath: '/Users/tester/repo',
            sourceRootPath: '/Users/tester/repo',
        });

        const { repoScmWorktreeService } = await import('./repoScmWorktreeService');
        await repoScmWorktreeService.createWorktreeForMachinePath({
            scope,
            machineId: 'machine-1',
            path: '~/repo/packages/app',
            baseRef: 'feature/auth',
        });

        expect(machineScmWorktreeCreateMock).toHaveBeenCalledWith(
            'machine-1',
            expect.objectContaining({
                cwd: '/Users/tester/repo/packages/app',
                baseRef: 'feature/auth',
            }),
            scope,
        );
    });

    it('removes and prunes worktrees through canonical machine SCM requests', async () => {
        machineScmWorktreeRemoveMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
        machineScmWorktreePruneMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });

        const { repoScmWorktreeService } = await import('./repoScmWorktreeService');
        const removeResult = await repoScmWorktreeService.removeWorktreeForMachinePath({
            scope,
            machineId: 'machine-1',
            path: '/repo',
            worktreePath: '/repo/.worktrees/feature-auth',
        });
        const pruneResult = await repoScmWorktreeService.pruneWorktreesForMachinePath({
            scope,
            machineId: 'machine-1',
            path: '/repo',
        });

        expect(machineScmWorktreeRemoveMock).toHaveBeenCalledWith(
            'machine-1',
            {
                cwd: '/repo',
                worktreePath: '/repo/.worktrees/feature-auth',
            },
            scope,
        );
        expect(machineScmWorktreePruneMock).toHaveBeenCalledWith(
            'machine-1',
            {
                cwd: '/repo',
            },
            scope,
        );
        expect(removeResult.success).toBe(true);
        expect(pruneResult.success).toBe(true);
    });
});
