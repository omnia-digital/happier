import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { listServerProfiles, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { parseToken } from '@/utils/auth/parseToken';

/** Resolve the saved credential that owns this notification, independent of the active tab. */
export async function resolveNotificationPermissionTarget(serverUrl: string, accountId?: string | null) {
    // An occurrence alone does not identify which saved account received the push.
    // Older unscoped notifications remain navigation-only.
    if (!accountId) return null;
    const key = createServerUrlComparableKey(serverUrl);
    if (!key) return null;
    const profile = listServerProfiles().find((candidate) => createServerUrlComparableKey(candidate.serverUrl) === key);
    if (!profile) return null;
    const serverId = resolveServerProfileScopeIdForIdentifier(profile.id);
    if (!serverId) return null;
    const credentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId });
    if (!credentials) return null;
    const scope = createServerAccountScope(serverId, parseToken(credentials.token));
    if (!scope || scope.accountId !== accountId) return null;
    return scope;
}
