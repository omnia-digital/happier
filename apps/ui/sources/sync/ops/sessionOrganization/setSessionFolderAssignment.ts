import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { setSessionFolderAssignment as setSessionFolderAssignmentApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';

export async function setSessionFolderAssignment(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionId: string;
    folderId: string | null;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().setSessionOrganizationFolderAssignmentOptimistic(
            params.serverId,
            params.sessionId,
            params.folderId,
        );
    });
    try {
        const response = await setSessionFolderAssignmentApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            sessionId: params.sessionId,
            request: { folderId: params.folderId },
        });
        await publish(() => {
            getStorage().getState().applySessionFolderAssignments(params.serverId, [response]);
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
