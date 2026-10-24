import type { storage } from '@/sync/domains/state/storageStore';
import { buildSessionOrganizationProjection, buildSessionOrganizationSnapshotFromProjection, type SessionOrganizationProjection } from '@/sync/domains/session/organization';
import { saveSessionOrganizationWarmCacheSnapshot } from '@/sync/domains/state/warmCachePersistence';

type SessionOrganizationSyncState = Pick<
    ReturnType<typeof storage.getState>,
    | 'sessionOrganizationSchemaVersionByServerId'
    | 'sessionOrganizationSnapshotVersionByServerId'
    | 'sessionOrganizationPinsBySessionKey'
    | 'sessionOrganizationFoldersByFolderKey'
    | 'sessionOrganizationFolderAssignmentsBySessionKey'
    | 'sessionOrganizationTagsByTagKey'
    | 'sessionOrganizationTagAssignmentsBySessionKey'
    | 'sessionOrganizationAttentionStandingsBySessionKey'
    | 'sessionOrganizationOrderEntriesByScopeKey'
    | 'sessionOrganizationLabelsByLabelKey'
>;

export function buildOrganizationProjectionForServer(
    state: SessionOrganizationSyncState,
    serverId: string | null,
): SessionOrganizationProjection | null {
    const normalizedServerId = typeof serverId === 'string' && serverId.trim().length > 0 ? serverId.trim() : null;
    if (!normalizedServerId) return null;
    return buildSessionOrganizationProjection({
        schemaVersionByServerId: state.sessionOrganizationSchemaVersionByServerId,
        snapshotVersionByServerId: state.sessionOrganizationSnapshotVersionByServerId,
        pinsBySessionKey: state.sessionOrganizationPinsBySessionKey,
        foldersByFolderKey: state.sessionOrganizationFoldersByFolderKey,
        folderAssignmentsBySessionKey: state.sessionOrganizationFolderAssignmentsBySessionKey,
        tagsByTagKey: state.sessionOrganizationTagsByTagKey,
        tagAssignmentsBySessionKey: state.sessionOrganizationTagAssignmentsBySessionKey,
        attentionStandingsBySessionKey: state.sessionOrganizationAttentionStandingsBySessionKey,
        orderEntriesByScopeKey: state.sessionOrganizationOrderEntriesByScopeKey,
        labelsByLabelKey: state.sessionOrganizationLabelsByLabelKey,
    }, normalizedServerId);
}

/**
 * Persist the organization the list is currently painting so the next boot repaints it before
 * the refresh lands. Written from the store rather than from a response so partial refreshes
 * (`refreshSessionOrganization`) stay represented, and skipped whenever the store does not hold
 * a complete snapshot for this server yet.
 */
export function persistSessionOrganizationWarmCache(
    serverId: string | null,
    accountId: string | null,
    projection: SessionOrganizationProjection | null,
): void {
    if (!serverId || !projection) return;
    const snapshot = buildSessionOrganizationSnapshotFromProjection(projection);
    if (!snapshot) return;
    saveSessionOrganizationWarmCacheSnapshot(serverId, accountId, snapshot);
}
