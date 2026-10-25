import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { upsertSessionOrganizationLabel as upsertSessionOrganizationLabelApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { UpsertSessionOrganizationLabelRequest } from '@happier-dev/protocol';
import {
    openSessionOrganizationLabelDisplay,
    prepareSessionOrganizationDisplayEnvelopeForWrite,
} from './sessionOrganizationDisplayEnvelope';

export async function upsertSessionLabel(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: UpsertSessionOrganizationLabelRequest;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    const request: UpsertSessionOrganizationLabelRequest = {
        ...params.request,
        display: await prepareSessionOrganizationDisplayEnvelopeForWrite({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            envelope: params.request.display,
        }),
    };
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().upsertSessionOrganizationLabelOptimistic(params.serverId, {
            labelKind: params.request.labelKind,
            scopeKey: params.request.scopeKey,
            display: params.request.display,
            archivedAt: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    });
    try {
        const response = await upsertSessionOrganizationLabelApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request,
        });
        const label = await openSessionOrganizationLabelDisplay({
            credentials: params.credentials,
            label: response.label,
        });
        await publish(() => {
            const reconcileRecordId = getStorage().getState().upsertSessionOrganizationLabelOptimistic(params.serverId, label);
            getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
        });
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
