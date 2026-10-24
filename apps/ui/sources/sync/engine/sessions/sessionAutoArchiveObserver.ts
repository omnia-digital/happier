import { readSessionPullRequestLinks, type SessionPullRequestLinkV1 } from '@happier-dev/protocol';
import { archiveSessionWithPendingState } from '@/components/sessions/sessionStopArchiveFlow';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { areServerAccountScopesEqual, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { assessSessionAutoArchiveCandidate, assessVerifiedSessionPullRequests } from '@/sync/domains/session/archive/sessionAutoArchiveEligibility';
import { readSessionArchivePending } from '@/sync/domains/session/listing/sessionArchiveState';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { readLinkedPullRequest } from '@/sync/ops/sessionPullRequestLinks';
import { sessionArchiveWithServerScope } from '@/sync/ops/sessions';
import { syncReliabilityTelemetry } from '@/sync/runtime/syncReliabilityTelemetry';

function linksStillMatch(left: readonly SessionPullRequestLinkV1[], right: readonly SessionPullRequestLinkV1[]): boolean {
    // A byte change only makes a pending read conservative; provider identity is verified by the read owner.
    return JSON.stringify(left) === JSON.stringify(right);
}

/** One foreground observer on the existing catalog and resume lifecycle; no provider-status cache or poller. */
export function createSessionAutoArchiveObserver(input: Readonly<{
    isForeground: () => boolean;
    ensureMetadata: (sessionId: string, serverId: string, shouldContinue: () => boolean) => Promise<boolean>;
}>): Readonly<{ recheck: () => void; dispose: () => void }> {
    let checked = new WeakSet<SessionListRenderableSession>();
    const inFlight = new Set<string>();
    let observedScopeKey: string | null = null;
    let wasEnabled = false;
    let disposed = false;

    const activeScope = (): ServerAccountScope | null => {
        const state = storage.getState();
        if (!input.isForeground() || state.settings.autoArchiveAfterLinkedPullRequestsMerge !== true) return null;
        const scope = state.profileScope;
        if (!scope || !areServerAccountScopesEqual(state.settingsScope, scope)) return null;
        if (!areServerProfileIdentifiersEquivalent(scope.serverId, getActiveServerSnapshot().serverId)) return null;
        return scope;
    };

    const scopeCurrent = (scope: ServerAccountScope): boolean => {
        const current = activeScope();
        return areServerAccountScopesEqual(current, scope);
    };

    const candidateCurrent = (scope: ServerAccountScope, sessionId: string, links: readonly SessionPullRequestLinkV1[]): boolean => {
        if (!scopeCurrent(scope)) return false;
        const state = storage.getState();
        const row = state.sessionListRenderables[sessionId];
        const full = state.sessions[sessionId];
        return !!row && !!full
            && (!full.serverId || areServerProfileIdentifiersEquivalent(full.serverId, scope.serverId))
            && full.active === false && full.archivedAt == null
            && assessSessionAutoArchiveCandidate({
                session: row, enabled: true, archivePending: readSessionArchivePending(state, sessionId, scope.serverId), accountId: scope.accountId,
            }).eligible
            && linksStillMatch(readSessionPullRequestLinks(row.metadata), links)
            && linksStillMatch(readSessionPullRequestLinks(full.metadata), links);
    };

    const attempt = async (scope: ServerAccountScope, row: SessionListRenderableSession, links: readonly SessionPullRequestLinkV1[]): Promise<void> => {
        const sessionId = row.id;
        const shouldContinue = () => scopeCurrent(scope);
        try {
            if (!await input.ensureMetadata(sessionId, scope.serverId, shouldContinue) || !candidateCurrent(scope, sessionId, links)) return;
            const results = [];
            for (const link of links) {
                if (!shouldContinue()) return;
                try {
                    results.push(await readLinkedPullRequest(sessionId, link));
                } catch {
                    syncReliabilityTelemetry.record('session.autoarchive.provider_unavailable');
                    return;
                }
            }
            const verified = assessVerifiedSessionPullRequests(links, results);
            if (!verified.eligible || !candidateCurrent(scope, sessionId, links)) return;
            const result = await archiveSessionWithPendingState(sessionId, () => sessionArchiveWithServerScope(sessionId, {
                serverId: scope.serverId,
                autoArchiveReason: { accountId: scope.accountId, links, shouldContinue },
            }), scope.serverId);
            if (result && !result.success) {
                syncReliabilityTelemetry.record('session.autoarchive.archive_failed', { code: result.code ?? 'unknown' });
            } else if (result && result.historyRecorded === false) {
                syncReliabilityTelemetry.recordCritical('session.autoarchive.reason_not_recorded');
            }
        } finally {
            inFlight.delete(`${serverAccountScopeKeySuffix(scope)}:${sessionId}`);
            if (!disposed) queueMicrotask(scan);
        }
    };

    const scan = (): void => {
        if (disposed) return;
        const scope = activeScope();
        const enabled = scope !== null;
        const nextScopeKey = scope ? serverAccountScopeKeySuffix(scope) : null;
        if (nextScopeKey !== observedScopeKey || enabled && !wasEnabled) checked = new WeakSet();
        observedScopeKey = nextScopeKey;
        wasEnabled = enabled;
        if (!scope) return;
        const state = storage.getState();
        for (const row of Object.values(state.sessionListRenderables)) {
            if (!row || checked.has(row)) continue;
            const decision = assessSessionAutoArchiveCandidate({
                session: row, enabled: true, archivePending: readSessionArchivePending(state, row.id, scope.serverId), accountId: scope.accountId,
            });
            if (!decision.eligible) continue;
            const key = `${nextScopeKey}:${row.id}`;
            if (inFlight.has(key)) continue;
            checked.add(row);
            inFlight.add(key);
            void attempt(scope, row, readSessionPullRequestLinks(row.metadata));
        }
    };

    const unsubscribe = storage.subscribe((state, previous) => {
        if (state.sessionListRenderables !== previous.sessionListRenderables
            || state.settings !== previous.settings || state.profileScope !== previous.profileScope
            || state.settingsScope !== previous.settingsScope || state.sessionArchiveOperations !== previous.sessionArchiveOperations) scan();
    });
    scan();
    return {
        recheck: () => { checked = new WeakSet(); scan(); },
        dispose: () => { disposed = true; unsubscribe(); },
    };
}
