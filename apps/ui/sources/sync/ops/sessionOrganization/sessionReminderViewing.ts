import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { resolveSessionReminderPresentation } from '@/sync/domains/session/organization/attentionStanding';
import { buildSessionOrganizationServerKey } from '@/sync/domains/session/organization/keys';
import { resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { getStorage } from '@/sync/domains/state/storageStore';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { setSessionAttentionStanding } from './setSessionAttentionStanding';

/** A focused opening is reminder acknowledgement, independently of transcript read state. */
export function beginSessionReminderViewing(
    sessionId: string,
    opts?: Readonly<{ serverId?: string | null }>,
): () => void {
    const store = getStorage();
    if (store.getState().settings.sessionReminderAutoClearOnOpen === false) return () => {};
    const requestedServerId = opts?.serverId?.trim() || resolvePreferredServerIdForSessionId(sessionId);
    const serverId = resolveServerProfileScopeIdForIdentifier(requestedServerId);
    if (!serverId) return () => {};
    const sessionKey = buildSessionOrganizationServerKey(serverId, sessionId);
    const openedAt = Date.now();

    const acknowledge = () => {
        const state = store.getState();
        const record = state.sessionOrganizationAttentionStandingsBySessionKey[sessionKey];
        if (state.settings.sessionReminderAutoClearOnOpen === false || !record
            || resolveSessionReminderPresentation(record, openedAt)?.state !== 'due') return;
        fireAndForget((async () => {
            const resolved = await resolveSessionOrganizationMutationScope(serverId);
            if (!resolved.ok) throw new Error(`Cannot clear due session reminder: missing ${resolved.reason}`);
            // Both scope lookup and publication yield. Compare the opened reminder at the
            // publication point so a replacement or another pane's clear cannot trigger a write.
            await setSessionAttentionStanding({
                ...resolved.scope,
                sessionId,
                remindAt: null,
                precondition: () => {
                    const current = store.getState();
                    const latestRecord = current.sessionOrganizationAttentionStandingsBySessionKey[sessionKey];
                    return current.settings.sessionReminderAutoClearOnOpen !== false
                        && latestRecord !== undefined
                        && latestRecord.remindAt === record.remindAt
                        && latestRecord.standing === record.standing
                        && latestRecord.updatedAt === record.updatedAt;
                },
            });
        })(), { tag: 'sessionReminderViewing.clearDueReminder' });
    };

    const state = store.getState();
    if (state.sessionOrganizationAttentionStandingsBySessionKey[sessionKey]
        || state.sessionOrganizationSnapshotVersionByServerId[serverId] !== undefined) {
        acknowledge();
        return () => {};
    }
    // Cold deep links can open before organization hydration. Observe its existing load once;
    // ordinary hydrated openings need no subscription, fetch, timer, or list scan.
    const unsubscribe = store.subscribe((next) => {
        if (next.sessionOrganizationSnapshotVersionByServerId[serverId] === undefined) return;
        unsubscribe();
        acknowledge();
    });
    return unsubscribe;
}
