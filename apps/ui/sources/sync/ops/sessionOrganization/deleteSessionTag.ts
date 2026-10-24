import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { deleteSessionOrganizationTag as deleteSessionOrganizationTagApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { DeleteSessionOrganizationTagRequest } from '@happier-dev/protocol';

export async function deleteSessionTag(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: DeleteSessionOrganizationTagRequest;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().deleteSessionOrganizationTagOptimistic(params.serverId, params.request.tagId);
    });
    try {
        const response = await deleteSessionOrganizationTagApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request: params.request,
        });
        if (response.removedAssignmentCount > 0) {
            await publish(() => getStorage().getState().reconcileSessionOrganizationTagDelete(params.serverId, response.tagId));
        }
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
