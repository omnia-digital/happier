import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { setSessionTagAssignments as setSessionTagAssignmentsApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';

export async function setSessionTagAssignments(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionId: string;
    tagIds: readonly string[];
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().setSessionTagAssignmentsOptimistic(params.serverId, params.sessionId, params.tagIds);
    });
    try {
        const response = await setSessionTagAssignmentsApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            sessionId: params.sessionId,
            request: { tagIds: [...params.tagIds] },
        });
        await publish(() => {
            const reconcileRecordId = getStorage().getState().setSessionTagAssignmentsOptimistic(params.serverId, response.sessionId, response.tagIds);
            getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
