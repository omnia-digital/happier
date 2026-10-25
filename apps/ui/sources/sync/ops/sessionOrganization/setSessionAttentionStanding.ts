import { type AuthCredentials } from '@/auth/storage/tokenStorage';
import { setSessionAttentionStanding as setSessionAttentionStandingApi } from '@/sync/api/session/sessionOrganizationApi';
import { createSessionOrganizationMutationPublisher, resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { getStorage } from '@/sync/domains/state/storageStore';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';

export async function setSessionAttentionStanding(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionId: string;
    standing?: boolean | null;
    remindAt?: number | null;
    /** Recheck a caller-owned precondition after the publisher's credential read. */
    precondition?: () => boolean;
}>): Promise<void> {
    const publish = createSessionOrganizationMutationPublisher(params);
    const previousStanding = getStorage().getState().sessionOrganizationAttentionStandingsBySessionKey[`${params.serverId}:${params.sessionId}`];
    const optimisticStanding = params.standing === null
        ? null
        : params.standing !== undefined
            ? { sessionId: params.sessionId, standing: params.standing, updatedAt: Date.now() }
            : typeof params.remindAt === 'number'
                ? { sessionId: params.sessionId, standing: previousStanding?.standing ?? false, remindAt: params.remindAt, updatedAt: Date.now() }
                : previousStanding == null
                    ? null
                    : { sessionId: params.sessionId, standing: previousStanding.standing, updatedAt: Date.now() };
    let recordId: string | null = null;
    let shouldSend = true;
    await publish(() => {
        if (params.precondition && !params.precondition()) {
            shouldSend = false;
            return;
        }
        recordId = getStorage().getState().setSessionAttentionStandingOptimistic(params.serverId, params.sessionId, optimisticStanding);
    });
    if (!shouldSend) return;
    try {
        const response = await setSessionAttentionStandingApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            sessionId: params.sessionId,
            request: params.standing !== undefined ? { standing: params.standing } : { remindAt: params.remindAt ?? null },
        });
        if (recordId) await publish(() => getStorage().getState().confirmSessionAttentionStandingOptimistic(recordId!, params.sessionId, response.standing));
    } catch (error) {
        if (recordId) await publish(() => getStorage().getState().rollbackSessionOrganizationOptimistic(recordId!));
        throw error;
    } finally {
        if (recordId) getStorage().getState().commitSessionOrganizationOptimistic(recordId);
    }
}

const MISSING_SCOPE_MESSAGE_BY_REASON = {
    'server-id': 'Missing server for session attention standing',
    'server-profile': 'Missing server profile for session attention standing',
    credentials: 'Missing server credentials for session attention standing',
} as const;

export type SessionSetAttentionStandingResult = Readonly<{
    success: boolean;
    message?: string;
}>;

async function sessionSetAttentionIntentWithServerScope(
    sessionId: string,
    intent: Readonly<{ standing?: boolean | null; remindAt?: number | null }>,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    const requestedServerId = typeof opts?.serverId === 'string' ? opts.serverId.trim() : '';
    const serverId = requestedServerId || resolvePreferredServerIdForSessionId(sessionId) || '';
    try {
        const resolved = await resolveSessionOrganizationMutationScope(serverId);
        if (!resolved.ok) return { success: false, message: MISSING_SCOPE_MESSAGE_BY_REASON[resolved.reason] };
        await setSessionAttentionStanding({
            credentials: resolved.scope.credentials,
            serverId: resolved.scope.serverId,
            serverUrl: resolved.scope.serverUrl,
            sessionId,
            ...intent,
        });
        return { success: true };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * The single-session entrypoint used by the shared session actions.
 *
 * Callers that already hold a server mutation context (bulk selection, settings screens) call
 * `setSessionAttentionStanding` directly; a menu item only knows the session and its server, so this
 * resolves the credentials for it and still writes through that one path.
 */
export async function sessionSetAttentionStandingWithServerScope(
    sessionId: string,
    standing: boolean,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    return sessionSetAttentionIntentWithServerScope(sessionId, { standing }, opts);
}

export async function sessionSetAttentionReminderWithServerScope(
    sessionId: string,
    remindAt: number,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    return sessionSetAttentionIntentWithServerScope(sessionId, { remindAt }, opts);
}

export async function sessionClearAttentionReminderWithServerScope(
    sessionId: string,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    return sessionSetAttentionIntentWithServerScope(sessionId, { remindAt: null }, opts);
}
