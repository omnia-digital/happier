import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { reorderSessionOrganization as reorderSessionOrganizationApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { ReorderSessionOrganizationRequest } from '@happier-dev/protocol';

export async function reorderSessionOrganization(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: ReorderSessionOrganizationRequest;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    const optimisticEntries = params.request.entries.map((entry) => ({
        scopeKind: params.request.scopeKind,
        scopeKey: params.request.scopeKey,
        itemKind: entry.itemKind,
        itemKey: entry.itemKey,
        sortKey: entry.sortKey,
    }));
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().applySessionOrganizationOrderScopeOptimistic(params.serverId, {
            scopeKind: params.request.scopeKind,
            scopeKey: params.request.scopeKey,
            entries: optimisticEntries,
        });
    });
    try {
        const response = await reorderSessionOrganizationApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request: params.request,
        });
        await publish(() => {
            const reconcileRecordId = getStorage().getState().applySessionOrganizationOrderScopeOptimistic(params.serverId, {
                scopeKind: params.request.scopeKind,
                scopeKey: params.request.scopeKey,
                entries: response.orderEntries,
            });
            getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
