import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { storage } from '@/sync/domains/state/storage';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export function resolveRepoScmMachinePathRequest(input: Readonly<{
    machineId: string;
    path: string;
    scope?: ServerAccountScope;
}>): Readonly<{
    machineId: string;
    resolvedPath: string;
    repoIdentityKey: string;
}> | null {
    const machineId = input.machineId.trim();
    const rawPath = input.path.trim();
    if (!machineId || !rawPath) {
        return null;
    }

    const state = storage.getState();
    const matchesActiveScope = !input.scope || (input.scope.serverId === state.profileScope?.serverId && input.scope.accountId === state.profileScope?.accountId);
    const homeDir = matchesActiveScope ? state.machines?.[machineId]?.metadata?.homeDir : undefined;
    // Without this account's home directory, preserve ~ for the owning daemon to expand.
    const resolvedPath = resolveAbsolutePath(rawPath, homeDir);
    return {
        machineId,
        resolvedPath,
        repoIdentityKey: `${machineId}:${resolvedPath}`,
    };
}
