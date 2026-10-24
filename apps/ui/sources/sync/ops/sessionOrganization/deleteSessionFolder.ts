import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { deleteSessionOrganizationFolder as deleteSessionOrganizationFolderApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { DeleteSessionOrganizationFolderRequest } from '@happier-dev/protocol';

export async function deleteSessionFolder(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: DeleteSessionOrganizationFolderRequest;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().deleteSessionOrganizationFolderOptimistic(params.serverId, params.request.folderId);
    });
    try {
        const response = await deleteSessionOrganizationFolderApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request: params.request,
        });
        await publish(() => {
            for (const folderId of response.deletedFolderIds) {
                const reconcileRecordId = getStorage().getState().deleteSessionOrganizationFolderOptimistic(params.serverId, folderId);
                getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
            }
            if (response.affectedAssignmentCount > 0) {
                getStorage().getState().reconcileSessionOrganizationFolderDelete(
                    params.serverId,
                    response.deletedFolderIds,
                    response.assignmentTargetFolderId,
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
