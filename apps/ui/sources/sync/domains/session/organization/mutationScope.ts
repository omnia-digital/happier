import { getStorage } from '@/sync/domains/state/storageStore';
import { isServerScopedSessionContextCurrent } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';
import { parseToken } from '@/utils/auth/parseToken';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { areServerProfileIdentifiersEquivalent, getServerProfileById, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';

/**
 * Credentials, target URL, and the server id every session-organization write must be keyed by.
 *
 * A server profile is stored under a URL-derived local id (`localhost-52753`), while every
 * server-scoped projection — sessions, session list view data, organization snapshots — is keyed by
 * the profile's canonical scope id (`serverIdentityId ?? id`). Resolving a profile for its
 * credentials and then reusing `profile.id` as the state key lands the write where nothing reads:
 * the request still succeeds and the server still keeps the value, so the surface only looks
 * correct again after a reload. Callers therefore key state by `serverId` here and leave
 * `profile.id` to the credential lookup that genuinely owns that namespace.
 */
export type SessionOrganizationMutationScope = Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl: string;
}>;

export type SessionOrganizationMutationScopeResult =
    | Readonly<{ ok: true; scope: SessionOrganizationMutationScope }>
    | Readonly<{ ok: false; reason: 'server-id' | 'server-profile' | 'credentials' }>;

/**
 * The single owner of "which server does this organization mutation belong to". Callers map the
 * failure reason onto whatever they already do when a mutation cannot run.
 */
export async function resolveSessionOrganizationMutationScope(
    serverIdRaw: string | null | undefined,
    expectedAccountId?: string,
): Promise<SessionOrganizationMutationScopeResult> {
    const requestedServerId = typeof serverIdRaw === 'string' ? serverIdRaw.trim() : '';
    if (!requestedServerId) return { ok: false, reason: 'server-id' };
    const serverProfile = getServerProfileById(requestedServerId);
    if (!serverProfile) return { ok: false, reason: 'server-profile' };
    const credentials = await TokenStorage.getCredentialsForServerUrl(serverProfile.serverUrl, {
        serverId: serverProfile.id,
    });
    if (!credentials) return { ok: false, reason: 'credentials' };
    if (expectedAccountId && parseToken(credentials.token) !== expectedAccountId) return { ok: false, reason: 'credentials' };
    return {
        ok: true,
        scope: {
            credentials,
            serverId: resolveServerProfileScopeId(serverProfile),
            serverUrl: serverProfile.serverUrl,
        },
    };
}

/** Keep local optimistic/result/rollback publication on the account that authorized the write. */
export function createSessionOrganizationMutationPublisher(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
}>): (publish: () => void) => Promise<boolean> {
    const targetServerUrl = params.serverUrl ?? getServerProfileById(params.serverId)?.serverUrl;
    const targetAccountId = parseToken(params.credentials.token);
    return async (publish) => {
        if (!targetServerUrl) return false;
        let credentialsChanged = false;
        const unsubscribe = TokenStorage.subscribeCredentialChanges(() => { credentialsChanged = true; });
        try {
            let current: boolean;
            do {
                credentialsChanged = false;
                current = await isServerScopedSessionContextCurrent({
                    targetServerId: params.serverId,
                    targetServerUrl,
                    targetAccountId,
                });
                // A storage read already in flight may return the preceding credentials.
                // Re-read only when the canonical owner reported a change during that read.
            } while (credentialsChanged);
            if (!current) return false;
            const activeScope = getStorage().getState().profileScope;
            if (activeScope && areServerProfileIdentifiersEquivalent(activeScope.serverId, params.serverId)
                && activeScope.accountId !== targetAccountId) return false;
            publish();
            return true;
        } finally {
            unsubscribe();
        }
    };
}
