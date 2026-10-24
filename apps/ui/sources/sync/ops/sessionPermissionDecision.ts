/** Canonical permission decision construction, dispatch, and local recovery. */
import type { SessionPermissionResponse } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { storage } from '@/sync/domains/state/storage';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent, getActiveServerId } from '@/sync/domains/server/serverProfiles';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { sessionRpcWithServerAccountScope, sessionRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc';
import { nowServerMs } from '@/sync/runtime/time';

export type SessionPermissionRequest = SessionPermissionResponse;

export const NOTIFICATION_PERMISSION_DENY_REASON = 'Denied from notification';

export function buildNotificationPermissionDecisionRequest(action: 'allow' | 'deny', requestId: string): SessionPermissionRequest {
    return action === 'allow'
        ? { id: requestId, approved: true, decision: 'approved' }
        : { id: requestId, approved: false, decision: 'denied', reason: NOTIFICATION_PERMISSION_DENY_REASON };
}

export function applySessionThinkingDecisionRecovery(sessionId: string): void {
    const session = storage.getState().sessions[sessionId];
    storage.getState().clearSessionOptimisticThinking(sessionId);
    storage.getState().clearSessionThinkingGrace(sessionId);
    if (!session || session.thinking !== true) return;
    storage.getState().applySessions([{ ...session, thinking: false, updatedAt: nowServerMs() }]);
}

export function isSessionPermissionDecisionAccepted(result: unknown): boolean {
    return typeof result === 'object' && result !== null && 'ok' in result && result.ok === true;
}

/** The legacy method remains available to released UIs and CLIs; occurrence calls never downgrade. */
export async function dispatchSessionPermissionDecision(params: Readonly<{
    sessionId: string;
    request: SessionPermissionRequest;
    target?: Readonly<{ scope: ServerAccountScope }> | Readonly<{ serverId?: string | null }>;
}>): Promise<unknown> {
    const explicitScope = params.target && 'scope' in params.target ? params.target.scope : null;
    const serverId = explicitScope?.serverId
        ?? (params.target && 'serverId' in params.target ? params.target.serverId : resolvePreferredServerIdForSessionId(params.sessionId));
    const recoveryScope = explicitScope ?? getActiveServerAccountScope();
    const recoveryOccurrenceId = params.request.occurrenceId
        ?? storage.getState().sessions[params.sessionId]?.agentState?.requests?.[params.request.id]?.occurrenceId;
    const method = typeof params.request.occurrenceId === 'string'
        ? SESSION_RPC_METHODS.SESSION_PERMISSION_RESPOND_TO_OCCURRENCE_V1
        : SESSION_RPC_METHODS.SESSION_PERMISSION_RESPOND_LEGACY;
    const result = explicitScope
        ? await sessionRpcWithServerAccountScope<unknown, SessionPermissionRequest>({
            scope: explicitScope, sessionId: params.sessionId, method, payload: params.request,
        })
        : await sessionRpcWithServerScope<unknown, SessionPermissionRequest>({
            sessionId: params.sessionId, serverId, method, payload: params.request,
        });

    const currentOccurrenceId = storage.getState().sessions[params.sessionId]?.agentState?.requests?.[params.request.id]?.occurrenceId;
    const activeScope = getActiveServerAccountScope();
    const stillTargetsActiveScope = recoveryScope
        ? areServerAccountScopesEqual(recoveryScope, activeScope)
        : activeScope === null && !explicitScope;
    if (params.request.approved === false
        && isSessionPermissionDecisionAccepted(result)
        && stillTargetsActiveScope
        && (!currentOccurrenceId || currentOccurrenceId === recoveryOccurrenceId)
        && (!serverId || areServerProfileIdentifiersEquivalent(serverId, getActiveServerId()))) {
        try {
            applySessionThinkingDecisionRecovery(params.sessionId);
        } catch {
            console.warn('[permissions] Permission deny local recovery unavailable');
        }
    }
    return result;
}

export async function sessionPermissionDecisionWithServerAccountScope(params: Readonly<{
    scope: ServerAccountScope;
    sessionId: string;
    requestId: string;
    occurrenceId: string;
    action: 'allow' | 'deny';
}>): Promise<unknown> {
    return await dispatchSessionPermissionDecision({
        sessionId: params.sessionId,
        request: { ...buildNotificationPermissionDecisionRequest(params.action, params.requestId), occurrenceId: params.occurrenceId },
        target: { scope: params.scope },
    });
}
