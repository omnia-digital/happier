import type { SessionListRenderableSession } from './sessionListRenderable';

type SessionHydrationRevision = Pick<SessionListRenderableSession,
    'seq' | 'updatedAt' | 'metadataVersion' | 'agentStateVersion'>;

/** A list projection can advance independently while full session hydration is still pending. */
export function isSessionHydrationRevisionCurrent(
    session: SessionHydrationRevision,
    currentRenderable: SessionListRenderableSession,
): boolean {
    if (currentRenderable.seq > session.seq) return false;
    if (currentRenderable.updatedAt > session.updatedAt) return false;
    if (currentRenderable.metadataVersion > session.metadataVersion) return false;
    if (currentRenderable.agentStateVersion > session.agentStateVersion) return false;
    return true;
}

/** Preserve independently newer metadata/request revisions when a full hydration is stale. */
export function buildSessionHydrationRenderablePatch(
    hydratedRenderable: SessionListRenderableSession,
    currentRenderable: SessionListRenderableSession,
): Partial<Omit<SessionListRenderableSession, 'id'>> | null {
    const patch: Partial<Omit<SessionListRenderableSession, 'id'>> = {};

    const shouldPatchMetadata =
        hydratedRenderable.metadata != null
        && currentRenderable.metadataVersion <= hydratedRenderable.metadataVersion
        && (
            currentRenderable.metadata == null
            || currentRenderable.metadataVersion < hydratedRenderable.metadataVersion
        );
    if (shouldPatchMetadata) {
        patch.metadata = hydratedRenderable.metadata;
        patch.metadataVersion = hydratedRenderable.metadataVersion;
    }

    const shouldPatchPendingFlags =
        currentRenderable.agentStateVersion <= hydratedRenderable.agentStateVersion
        && (
            currentRenderable.agentStateVersion < hydratedRenderable.agentStateVersion
            || typeof currentRenderable.hasPendingPermissionRequests !== 'boolean'
            || typeof currentRenderable.hasPendingUserActionRequests !== 'boolean'
        );
    if (shouldPatchPendingFlags) {
        patch.agentStateVersion = hydratedRenderable.agentStateVersion;
        patch.pendingRequestObservedAt = hydratedRenderable.pendingRequestObservedAt ?? null;
        if (typeof hydratedRenderable.hasPendingPermissionRequests === 'boolean') {
            patch.hasPendingPermissionRequests = hydratedRenderable.hasPendingPermissionRequests;
        }
        if (typeof hydratedRenderable.hasPendingUserActionRequests === 'boolean') {
            patch.hasPendingUserActionRequests = hydratedRenderable.hasPendingUserActionRequests;
        }
    }

    if (Object.keys(patch).length === 0) return null;
    return patch;
}
