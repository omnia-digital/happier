import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { storage } from '@/sync/domains/state/storage';
import { applyLocalSettingsFromUi } from '@/sync/store/settingsWriters';
import {
    readRepositoryAssociation,
    repositoryWorkspaceKey,
    resolveRepositoryRemote,
    withRepositoryAssociation,
    type RepositoryWorkspace,
} from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { normalizeSessionPathForProjectGrouping } from '@/sync/domains/session/listing/sessionListProjectGroupingKeys';

export type RepositoryDiscoveryWorkspace = Readonly<{ serverId: string; machineId: string; path: string }>;
export type RepositoryDiscoveryFailure = Readonly<{ workspace: RepositoryDiscoveryWorkspace; error: unknown }>;

/** Shared discovery owner for explicit refresh/selection and newly arriving workspaces. */
export async function discoverSessionRepositories(input: Readonly<{
    workspaces: readonly RepositoryDiscoveryWorkspace[];
    refresh?: boolean;
    verifyNewWorkspace?: boolean;
    isCurrent: () => boolean;
}>): Promise<RepositoryDiscoveryFailure[]> {
    const failures: RepositoryDiscoveryFailure[] = [];
    const visited = new Set<string>();
    for (const target of input.workspaces) {
        if (!input.isCurrent()) break;
        try {
            const scope = await scmRepositoryService.resolveScopeForServer(target.serverId);
            if (!input.isCurrent()) break;
            if (!scope) throw new Error('Repository account scope is unavailable');
            const workspace: RepositoryWorkspace = { ...target, ...scope };
            const key = repositoryWorkspaceKey(workspace);
            if (visited.has(key)) continue;
            visited.add(key);
            const previous = readRepositoryAssociation(storage.getState().localSettings.sessionRepositoryAssociationsV1, workspace);
            if (!input.refresh && (previous?.manual || previous?.identity)) continue;
            // An arriving worktree may lie beneath a cached root but be absent from
            // that older snapshot's worktree list. Read the new cwd from the daemon.
            const cached = input.refresh || input.verifyNewWorkspace ? null : scmRepositoryService.readCachedSnapshotForMachinePath({ ...workspace, scope });
            const snapshot = cached ?? await scmRepositoryService.fetchSnapshotForMachinePath({ ...workspace, scope });
            if (!input.isCurrent()) break;
            if (!snapshot) throw new Error('Repository snapshot is unavailable');
            const identity = snapshot.repo.isRepo ? resolveRepositoryRemote(snapshot.repo.remotes ?? []) : null;
            const rootPath = normalizeSessionPathForProjectGrouping(snapshot.repo.rootPath || workspace.path, null);
            const worktreePaths = (snapshot.repo.worktrees ?? []).map(worktree => normalizeSessionPathForProjectGrouping(worktree.path, null));
            for (const path of [rootPath, ...worktreePaths]) visited.add(repositoryWorkspaceKey({ ...workspace, path }));
            const current = storage.getState().localSettings.sessionRepositoryAssociationsV1;
            const next = withRepositoryAssociation(current, workspace, {
                identity, label: identity ?? workspace.path, rootPath, worktreePaths,
            });
            if (next !== current) applyLocalSettingsFromUi({ sessionRepositoryAssociationsV1: next });
        } catch (error) {
            if (input.isCurrent()) failures.push({ workspace: target, error });
        }
    }
    return failures;
}
