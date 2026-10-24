import { compareSessionFolderWorkspaceRefs } from '@/sync/domains/session/folders/workspaceRefs';
import type { SessionListTreeContainerMetadata, SessionListTreeRowMetadata } from './sessionListTreeTypes';

/** Display siblings can span checkouts; assigning a real folder cannot. */
export function isSessionListTreeDestinationCompatible(
    source: SessionListTreeRowMetadata,
    destination: SessionListTreeContainerMetadata,
): boolean {
    if (source.rootId !== destination.rootId) return false;
    if (destination.displayOrderOnly) return true;
    return !source.workspace || !destination.workspace || compareSessionFolderWorkspaceRefs(source.workspace, destination.workspace);
}
