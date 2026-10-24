import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { scmRepositoryService } from '@/scm/scmRepositoryService';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';
import { normalizeWorkspaceRootPath, tryBuildWorkspaceCacheKey } from '@/sync/domains/workspaces/workspaceScope';

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

export function resolveNewSessionReviewCommentsScope(params: Readonly<{
    targetServerId?: string | null;
    scmScope?: ServerAccountScope | null;
    selectedMachineId?: string | null;
    selectedMachineHomeDir?: string | null;
    selectedPath?: string | null;
}>): WorkspaceScopeBase | null {
    const serverId = normalizeText(params.targetServerId);
    const machineId = normalizeText(params.selectedMachineId);
    const selectedPath = normalizeText(params.selectedPath);
    if (!serverId || !machineId || !selectedPath) {
        return null;
    }

    const homeDir = normalizeText(params.selectedMachineHomeDir);
    const resolvedSelectedPath = resolveAbsolutePath(selectedPath, homeDir || undefined);
    const cachedSnapshot = params.scmScope ? scmRepositoryService.readCachedSnapshotForMachinePath({
        scope: params.scmScope,
        machineId,
        path: resolvedSelectedPath,
    }) : null;
    const preferredRootPath = cachedSnapshot?.repo?.isRepo === true
        ? cachedSnapshot.repo.rootPath
        : resolvedSelectedPath;
    const rootPath = normalizeWorkspaceRootPath(preferredRootPath);
    if (!rootPath) {
        return null;
    }

    const scope = { serverId, machineId, rootPath };
    return tryBuildWorkspaceCacheKey(scope) ? scope : null;
}
