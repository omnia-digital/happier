import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { moveSessionFolderAssignments as moveSessionFolderAssignmentsApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';

export async function moveSessionFolderAssignments(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    fromFolderIds: readonly string[];
    toFolderId: string | null;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().moveSessionFolderAssignmentsOptimistic(
            params.serverId,
            params.fromFolderIds,
            params.toFolderId,
        );
    });
    try {
        const response = await moveSessionFolderAssignmentsApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request: {
                fromFolderIds: [...params.fromFolderIds],
                toFolderId: params.toFolderId,
            },
        });
        await publish(() => {
            if (recordId) {
                getStorage().getState().rollbackSessionOrganizationOptimistic(recordId);
            }
            if (response.assignments.length > 0) {
                getStorage().getState().applySessionFolderAssignments(
                    params.serverId,
                    response.assignments.map((assignment) => ({
                        sessionId: assignment.sessionId,
                        folderId: response.toFolderId,
                    })),
                );
            }
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
