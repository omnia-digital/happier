import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { fetchSessionFolderAssignmentsForSessions } from '@/sync/api/session/sessionOrganizationApi';
import { buildSessionOrganizationServerKey } from '@/sync/domains/session/organization';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createSessionOrganizationMutationPublisher } from '@/sync/domains/session/organization/mutationScope';
import { parseToken } from '@/utils/auth/parseToken';

type SessionFolderAssignmentFetchPolicy = 'all' | 'missing';

const missingAssignmentFetchesBySessionKey = new Map<string, Promise<unknown>>();

function getSessionAssignmentKey(serverId: string, accountId: string, sessionId: string): string {
    return JSON.stringify([serverId, accountId, sessionId]);
}

function filterInFlightAssignmentSessionIds(params: Readonly<{
    serverId: string;
    accountId: string;
    sessionIds: readonly string[];
}>): string[] {
    return params.sessionIds.filter((sessionId) => (
        !missingAssignmentFetchesBySessionKey.has(getSessionAssignmentKey(params.serverId, params.accountId, sessionId))
    ));
}

function registerInFlightAssignmentFetch(params: Readonly<{
    serverId: string;
    accountId: string;
    sessionIds: readonly string[];
    promise: Promise<unknown>;
}>): void {
    for (const sessionId of params.sessionIds) {
        missingAssignmentFetchesBySessionKey.set(getSessionAssignmentKey(params.serverId, params.accountId, sessionId), params.promise);
    }
}

function unregisterInFlightAssignmentFetch(params: Readonly<{
    serverId: string;
    accountId: string;
    sessionIds: readonly string[];
    promise: Promise<unknown>;
}>): void {
    for (const sessionId of params.sessionIds) {
        const key = getSessionAssignmentKey(params.serverId, params.accountId, sessionId);
        if (missingAssignmentFetchesBySessionKey.get(key) === params.promise) {
            missingAssignmentFetchesBySessionKey.delete(key);
        }
    }
}

function filterMissingAssignmentSessionIds(params: Readonly<{
    assignmentsBySessionKey: Record<string, string | null>;
    serverId: string;
    sessionIds: readonly string[];
}>): string[] {
    return params.sessionIds.filter((sessionId) => (
        !Object.prototype.hasOwnProperty.call(
            params.assignmentsBySessionKey,
            buildSessionOrganizationServerKey(params.serverId, sessionId),
        )
    ));
}

function resolveFetchedAssignments(params: Readonly<{
    requestedSessionIds: readonly string[];
    assignments: readonly { sessionId: string; folderId: string | null }[];
}>): { sessionId: string; folderId: string | null }[] {
    const assignedFolderBySessionId = new Map(
        params.assignments.map((assignment) => [assignment.sessionId, assignment.folderId]),
    );
    return Array.from(new Set(params.requestedSessionIds)).map((sessionId) => ({
        sessionId,
        folderId: assignedFolderBySessionId.get(sessionId) ?? null,
    }));
}

export async function fetchAndApplySessionFolderAssignments(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionIds: readonly string[];
    fetchPolicy?: SessionFolderAssignmentFetchPolicy;
    shouldContinue?: () => boolean;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    const accountId = parseToken(params.credentials.token);
    const store = getStorage().getState();
    const sessionIdsMissingFromCache = params.fetchPolicy === 'missing'
        ? filterMissingAssignmentSessionIds({
            assignmentsBySessionKey: store.sessionOrganizationFolderAssignmentsBySessionKey,
            serverId: params.serverId,
            sessionIds: params.sessionIds,
        })
        : params.sessionIds;
    const sessionIds = params.fetchPolicy === 'missing'
        ? filterInFlightAssignmentSessionIds({
            serverId: params.serverId,
            accountId,
            sessionIds: sessionIdsMissingFromCache,
        })
        : sessionIdsMissingFromCache;
    if (sessionIds.length === 0) {
        if (sessionIdsMissingFromCache.length === 0) {
            await publish(() => getStorage().getState().setSessionFolderAssignmentsLoading(params.serverId, false));
        }
        return;
    }
    const fetchPromise = fetchSessionFolderAssignmentsForSessions({
        credentials: params.credentials,
        serverUrl: params.serverUrl,
        sessionIds,
    });
    // The publication credential read can yield after the HTTP promise rejects.
    // Observe it now; the original rejection still reaches the await below.
    void fetchPromise.catch(() => undefined);
    if (params.fetchPolicy === 'missing') {
        registerInFlightAssignmentFetch({
            serverId: params.serverId,
            accountId,
            sessionIds,
            promise: fetchPromise,
        });
    }
    try {
        await publish(() => getStorage().getState().setSessionFolderAssignmentsLoading(params.serverId, true));
        const response = await fetchPromise;
        if (params.shouldContinue && !params.shouldContinue()) return;
        await publish(() => {
            if (params.shouldContinue && !params.shouldContinue()) return;
            const currentStore = getStorage().getState();
            const applySessionIds = params.fetchPolicy === 'missing'
                ? filterMissingAssignmentSessionIds({
                    assignmentsBySessionKey: currentStore.sessionOrganizationFolderAssignmentsBySessionKey,
                    serverId: params.serverId,
                    sessionIds,
                })
                : sessionIds;
            currentStore.applySessionFolderAssignments(params.serverId, resolveFetchedAssignments({
                requestedSessionIds: applySessionIds,
                assignments: response.assignments,
            }));
        });
    } finally {
        if (params.fetchPolicy === 'missing') {
            unregisterInFlightAssignmentFetch({
                serverId: params.serverId,
                accountId,
                sessionIds,
                promise: fetchPromise,
            });
        }
        if (!params.shouldContinue || params.shouldContinue()) {
            await publish(() => getStorage().getState().setSessionFolderAssignmentsLoading(params.serverId, false));
        }
    }
}
