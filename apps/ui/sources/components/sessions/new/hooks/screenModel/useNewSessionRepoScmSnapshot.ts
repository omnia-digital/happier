import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';

import {
    mergeWorktreesEnrichmentIntoSnapshot,
    scmRepositoryService,
} from '@/scm/scmRepositoryService';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

import { pathBelongsToRepo } from './worktreePathComparison';

/**
 * Fetches the SCM snapshot in TWO stages so the worktree picker chip can render
 * within sub-second latency even on repos with many active worktrees:
 *
 * 1. **Light fetch** (`fetchSnapshotForMachinePath` with NO `includeWorktreeStatus`).
 *    This returns the repo + branch + worktree-list quickly; the chip becomes
 *    visible as soon as this completes.
 * 2. **Background enrichment** (`fetchWorktreesEnrichment`). Once the light
 *    snapshot is in, we kick off the per-worktree `changeCount` +
 *    `lastActivityAt` fetch and merge it into the snapshot when it arrives.
 *    The merge produces a new snapshot reference so consumers re-render with
 *    the augmented data without losing the light-snapshot rows.
 *
 * Both layers have INDEPENDENT cache slots inside `scmRepositoryService` so a
 * background enrichment refresh never invalidates the light data driving the
 * chip. Stale-while-revalidate is implemented per layer (cached value returned
 * immediately, refresh happens in the background).
 */
export function useNewSessionRepoScmSnapshot(input: Readonly<{
    machineId: string | null;
    path: string;
    scope: ServerAccountScope | null;
}>): ScmWorkingSnapshot | null {
    const targetKey = input.scope && input.machineId?.trim()
        ? JSON.stringify([input.scope.serverId, input.scope.accountId, input.machineId.trim()])
        : null;
    const [state, setState] = React.useState<{ targetKey: string | null; snapshot: ScmWorkingSnapshot | null }>(() => {
        const machineId = input.machineId?.trim() ?? '';
        const path = input.path.trim();
        if (!input.scope || !machineId || !path) return { targetKey, snapshot: null };
        const light = scmRepositoryService.readCachedSnapshotForMachinePath({
            machineId,
            path,
            scope: input.scope,
        });
        if (!light) return { targetKey, snapshot: null };
        const enrichment = scmRepositoryService.readCachedWorktreesEnrichment({
            machineId,
            path,
            scope: input.scope,
        });
        return { targetKey, snapshot: enrichment ? mergeWorktreesEnrichmentIntoSnapshot(light, enrichment) : light };
    });

    const refreshSnapshot = React.useCallback(() => {
        const machineId = input.machineId?.trim() ?? '';
        const path = input.path.trim();
        const scope = input.scope;
        if (!scope || !machineId || !path) {
            setState({ targetKey, snapshot: null });
            return () => {};
        }

        let cancelled = false;
        const cachedLight = scmRepositoryService.readCachedSnapshotForMachinePath({
            machineId,
            path,
            scope,
        });
        const cachedEnrichment = scmRepositoryService.readCachedWorktreesEnrichment({
            machineId,
            path,
            scope,
        });
        const seededFromCache = cachedLight && cachedEnrichment
            ? mergeWorktreesEnrichmentIntoSnapshot(cachedLight, cachedEnrichment)
            : cachedLight;
        // Seed the snapshot for this path. When the new path has no cache of its
        // own BUT belongs to the SAME repository as the snapshot we're already
        // showing (e.g. the user just switched the checkout to a sibling
        // worktree), keep that snapshot instead of resetting to null: a repo's
        // `git worktree list` is repo-wide and identical across its worktrees, so
        // a reset would only flash the chip's worktree list empty for one
        // round-trip until the new path's light fetch lands. (Honors the UI rule
        // against flashing empty states for already-hydrated lists.)
        const applySeed = () => {
            setState((previousState) => {
                if (seededFromCache) return { targetKey, snapshot: seededFromCache };
                const previous = previousState.targetKey === targetKey ? previousState.snapshot : null;
                if (previous && pathBelongsToRepo({
                    candidatePath: path,
                    repoRootPath: previous.repo.rootPath,
                    worktreePaths: (previous.repo.worktrees ?? []).map((worktree) => worktree.path),
                })) {
                    return previousState;
                }
                return { targetKey, snapshot: null };
            });
        };
        applySeed();

        void (async () => {
            try {
                // STAGE 1: Light fetch (fast).
                const lightSnapshot = await scmRepositoryService.fetchSnapshotForMachinePath({
                    machineId,
                    path,
                    scope,
                });
                if (cancelled) return;
                // Apply any cached enrichment immediately so the chip doesn't
                // lose its accessories while the background refresh runs.
                const lightWithCachedEnrichment = lightSnapshot && cachedEnrichment
                    ? mergeWorktreesEnrichmentIntoSnapshot(lightSnapshot, cachedEnrichment)
                    : lightSnapshot;
                setState({ targetKey, snapshot: lightWithCachedEnrichment });

                // STAGE 2: Background enrichment for the freshly listed worktrees.
                const worktreePaths = lightSnapshot?.repo.worktrees?.map((w) => w.path) ?? [];
                if (worktreePaths.length === 0) return;

                const enrichment = await scmRepositoryService.fetchWorktreesEnrichment({
                    machineId,
                    path,
                    scope,
                    worktreePaths,
                });
                if (cancelled || !enrichment || !lightSnapshot) return;
                setState({ targetKey, snapshot: mergeWorktreesEnrichmentIntoSnapshot(lightSnapshot, enrichment) });
            } catch (_error) {
                if (!cancelled) {
                    applySeed();
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [input.machineId, input.path, input.scope?.serverId, input.scope?.accountId, targetKey]);

    React.useEffect(() => {
        return refreshSnapshot();
    }, [refreshSnapshot]);

    useFocusEffect(refreshSnapshot);

    return state.targetKey === targetKey ? state.snapshot : null;
}
