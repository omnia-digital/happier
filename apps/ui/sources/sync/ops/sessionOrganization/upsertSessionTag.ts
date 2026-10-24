import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { upsertSessionOrganizationTag as upsertSessionOrganizationTagApi } from '@/sync/api/session/sessionOrganizationApi';
import { readSessionOrganizationServerScopedId } from '@/sync/domains/session/organization';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import type { CreateOrUpdateSessionOrganizationTagRequest, SessionOrganizationTag } from '@happier-dev/protocol';
import { createSessionOrganizationOpaqueId } from './sessionOrganizationIdAllocation';
import {
    openSessionOrganizationTagDisplay,
    prepareSessionOrganizationDisplayEnvelopeForWrite,
} from './sessionOrganizationDisplayEnvelope';

type ConcreteSessionOrganizationTagRequest = CreateOrUpdateSessionOrganizationTagRequest & {
    tagId: string;
};

function readCurrentTagIds(serverId: string): Set<string> {
    const state = getStorage().getState();
    const ids = new Set<string>();
    for (const key of Object.keys(state.sessionOrganizationTagsByTagKey)) {
        const id = readSessionOrganizationServerScopedId(key, serverId);
        if (id) ids.add(id);
    }
    return ids;
}

export async function upsertSessionTag(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    request: CreateOrUpdateSessionOrganizationTagRequest;
}>): Promise<SessionOrganizationTag> {
    const publish = createSessionOrganizationMutationPublisher(params);
    const request: ConcreteSessionOrganizationTagRequest = {
        ...params.request,
        tagId: params.request.tagId ?? createSessionOrganizationOpaqueId({
            prefix: 'tag',
            usedIds: readCurrentTagIds(params.serverId),
        }),
        display: await prepareSessionOrganizationDisplayEnvelopeForWrite({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            envelope: params.request.display,
        }),
    };
    const now = Date.now();
    const optimisticTag = await openSessionOrganizationTagDisplay({
        credentials: params.credentials,
        tag: {
            tagId: request.tagId,
            tagKey: request.tagKey,
            sortKey: request.sortKey ?? null,
            display: request.display,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
        },
    });
    let recordId: string | null = null;
    await publish(() => {
        recordId = getStorage().getState().upsertSessionOrganizationTagOptimistic(params.serverId, optimisticTag);
    });
    try {
        const response = await upsertSessionOrganizationTagApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            request,
        });
        const tag = await openSessionOrganizationTagDisplay({
            credentials: params.credentials,
            tag: response.tag,
        });
        await publish(() => {
            const reconcileRecordId = getStorage().getState().upsertSessionOrganizationTagOptimistic(params.serverId, tag);
            getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
        });
        return tag;
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}
