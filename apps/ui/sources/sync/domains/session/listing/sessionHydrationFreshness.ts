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
