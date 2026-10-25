import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { deleteSessionOrganizationLabel as deleteSessionOrganizationLabelApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { DeleteSessionOrganizationLabelRequest } from '@happier-dev/protocol';

export async function deleteSessionLabel(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: DeleteSessionOrganizationLabelRequest;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().deleteSessionOrganizationLabelOptimistic(
            params.serverId,
            params.request.labelKind,
            params.request.scopeKey,
        );
    });
    try {
        await deleteSessionOrganizationLabelApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request: params.request,
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
