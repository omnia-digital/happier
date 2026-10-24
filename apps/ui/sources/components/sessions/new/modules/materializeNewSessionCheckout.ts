import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { repoScmWorktreeService } from '@/scm/repository/repoScmWorktreeService';
import { resolveSessionPathWithinWorktree } from '@/scm/repository/resolveSessionPathWithinWorktree';
import type { NewSessionCheckoutCreationDraft } from '@/sync/domains/state/newSessionCheckoutDraft';

export interface MaterializeNewSessionCheckoutParams {
    machineId: string;
    scope?: ServerAccountScope;
    selectedPath: string;
    checkoutCreationDraft?: NewSessionCheckoutCreationDraft | null;
}

export type MaterializeNewSessionCheckoutResult =
    | {
        success: true;
        path: string;
        sessionPath: string;
        repositoryRootPath: string;
      }
    | {
        success: false;
        error: string;
      };

export async function materializeNewSessionCheckout(
    params: Readonly<MaterializeNewSessionCheckoutParams>,
): Promise<MaterializeNewSessionCheckoutResult> {
    if (params.checkoutCreationDraft?.kind !== 'git_worktree') {
        return {
            success: true,
            path: params.selectedPath,
            sessionPath: params.selectedPath,
            repositoryRootPath: params.selectedPath,
        };
    }

    if (!params.scope) return { success: false, error: 'Worktree target is unavailable' };

    const worktreeResult = await repoScmWorktreeService.createWorktreeForMachinePath({
        machineId: params.machineId,
        scope: params.scope,
        path: params.selectedPath,
        displayName: params.checkoutCreationDraft?.displayName ?? null,
        baseRef: params.checkoutCreationDraft?.baseRef ?? null,
        branchMode: params.checkoutCreationDraft?.branchMode ?? 'new',
    });
    if (!worktreeResult.success) {
        return {
            success: false,
            error: worktreeResult.error || 'Unknown error',
        };
    }

    return {
        success: true,
        path: worktreeResult.worktreePath,
        sessionPath: resolveSessionPathWithinWorktree({
            selectedPath: params.selectedPath,
            worktreePath: worktreeResult.worktreePath,
            sourceRootPath: worktreeResult.sourceRootPath || params.selectedPath,
        }),
        repositoryRootPath: worktreeResult.repositoryRootPath || params.selectedPath,
    };
}
