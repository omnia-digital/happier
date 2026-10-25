import { readSessionPullRequestLinks, type SessionPullRequestLinkV1 } from '@happier-dev/protocol';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { areServerAccountScopesEqual, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { assessSessionAutoArchiveCandidate, assessSessionAutoArchiveHydrationCandidate, assessVerifiedSessionPullRequests } from '@/sync/domains/session/archive/sessionAutoArchiveEligibility';
import { readSessionArchivePending } from '@/sync/domains/session/listing/sessionArchiveState';
import { buildSessionListRenderableFromSession, type SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { createTaskLimiter } from '@/sync/runtime/orchestration/runTasksWithLimit';
import { syncReliabilityTelemetry } from '@/sync/runtime/syncReliabilityTelemetry';

export const SESSION_AUTO_ARCHIVE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function linksStillMatch(left: readonly SessionPullRequestLinkV1[], right: readonly SessionPullRequestLinkV1[]): boolean {
    // A byte change only makes a pending read conservative; provider identity is verified by the read owner.
    return JSON.stringify(left) === JSON.stringify(right);
}

/** One foreground observer on the existing catalog and Sync lifecycle; no provider-status cache. */
export function createSessionAutoArchiveObserver(input: Readonly<{
    isForeground: () => boolean;
    ensureMetadata: (sessionId: string, serverId: string, shouldContinue: () => boolean, forceRefresh: boolean) => Promise<boolean>;
    checkIntervalMs: number;
    maxConcurrentCandidates: number;
}>): Readonly<{ recheck: () => void; dispose: () => void }> {
    let checked = new WeakSet<SessionListRenderableSession>();
    const candidateLimiter = createTaskLimiter(input.maxConcurrentCandidates);
    const inFlight = new Set<string>();
    const pendingHistory = new Map<string, Readonly<{ scope: ServerAccountScope; sessionId: string; archivedAt: number; links: readonly SessionPullRequestLinkV1[] }>>();
    const historyInFlight = new Set<string>();
    let observedScopeKey: string | null = null;
    let wasEnabled = false;
    let disposed = false;
    let checkTimer: ReturnType<typeof setTimeout> | null = null;

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

    const historyScopeCurrent = (scope: ServerAccountScope): boolean => input.isForeground()
        && areServerAccountScopesEqual(storage.getState().profileScope, scope)
        && areServerProfileIdentifiersEquivalent(scope.serverId, getActiveServerSnapshot().serverId);

    const candidateCurrent = (scope: ServerAccountScope, sessionId: string, links: readonly SessionPullRequestLinkV1[], allowOwnPending = false): boolean => {
        if (!scopeCurrent(scope)) return false;
        const state = storage.getState();
        const row = state.sessionListRenderables[sessionId];
        const full = state.sessions[sessionId];
        const pending = readSessionArchivePending(state, sessionId, scope.serverId);
        return !!row && !!full
            && (!full.serverId || areServerProfileIdentifiersEquivalent(full.serverId, scope.serverId))
            && full.active === false && full.archivedAt == null
            && full.metadataVersion >= row.metadataVersion
            && assessSessionAutoArchiveHydrationCandidate({
                session: row, enabled: true, archivePending: allowOwnPending ? false : pending, accountId: scope.accountId,
            }).eligible
            && assessSessionAutoArchiveCandidate({
                session: buildSessionListRenderableFromSession(full), enabled: true, archivePending: allowOwnPending ? false : pending, accountId: scope.accountId,
                authenticatedOwnerAccountId: full.authenticatedOwnerAccountId,
            }).eligible
            && linksStillMatch(readSessionPullRequestLinks(full.metadata), links);
    };

    const hydrationCandidateCurrent = (scope: ServerAccountScope, sessionId: string): boolean => {
        if (!scopeCurrent(scope)) return false;
        const state = storage.getState();
        const row = state.sessionListRenderables[sessionId];
        return !!row && assessSessionAutoArchiveHydrationCandidate({
            session: row, enabled: true,
            archivePending: readSessionArchivePending(state, sessionId, scope.serverId), accountId: scope.accountId,
        }).eligible;
    };

    const attempt = async (scope: ServerAccountScope, row: SessionListRenderableSession): Promise<void> => {
        const sessionId = row.id;
        const shouldContinue = () => scopeCurrent(scope);
        try {
            if (!hydrationCandidateCurrent(scope, sessionId)) return;
            // Sync owns this observer; load operations after its singleton has initialized.
            const [{ readLinkedPullRequest }, { archiveSessionWithPendingState }, { sessionArchiveWithServerScope }] = await Promise.all([
                import('@/sync/ops/sessionPullRequestLinks'),
                import('@/components/sessions/sessionStopArchiveFlow'),
                import('@/sync/ops/sessions'),
            ]);
            const current = storage.getState();
            const full = current.sessions[sessionId];
            const forceRefresh = !!full?.metadata && (
                full.metadataVersion < (current.sessionListRenderables[sessionId]?.metadataVersion ?? 0)
                || (full.accessLevel !== 'admin' && full.authenticatedOwnerAccountId !== scope.accountId)
            );
            if (!await input.ensureMetadata(sessionId, scope.serverId, shouldContinue, forceRefresh)) return;
            // Metadata hydration may replace the catalog object. It is still this cadence's candidate;
            // only a later independent change or the next scheduled check should read its PRs again.
            const hydratedRow = storage.getState().sessionListRenderables[sessionId];
            if (hydratedRow) checked.add(hydratedRow);
            const links = readSessionPullRequestLinks(storage.getState().sessions[sessionId]?.metadata);
            if (!candidateCurrent(scope, sessionId, links)) return;
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
                autoArchiveReason: { accountId: scope.accountId, links, shouldContinue: () => historyScopeCurrent(scope), shouldArchive: () => candidateCurrent(scope, sessionId, links, true) },
            }), scope.serverId);
            if (result && !result.success) {
                syncReliabilityTelemetry.record('session.autoarchive.archive_failed', { code: result.code ?? 'unknown' });
            } else if (result && result.historyRecorded === false) {
                if (result.archivedAt) pendingHistory.set(`${serverAccountScopeKeySuffix(scope)}:${sessionId}`, {
                    scope, sessionId, archivedAt: result.archivedAt, links,
                });
                syncReliabilityTelemetry.recordCritical('session.autoarchive.reason_not_recorded');
            }
        } finally {
            inFlight.delete(`${serverAccountScopeKeySuffix(scope)}:${sessionId}`);
            if (!disposed) queueMicrotask(scan);
        }
    };

    const retryPendingHistory = (): void => {
        for (const [key, pending] of pendingHistory) {
            if (historyInFlight.has(key) || !historyScopeCurrent(pending.scope)) continue;
            historyInFlight.add(key);
            void import('@/sync/ops/sessions').then(({ afterSessionArchiveConfirmed }) => afterSessionArchiveConfirmed({
                sessionId: pending.sessionId, serverId: pending.scope.serverId, archivedAt: pending.archivedAt,
                autoArchiveReason: { accountId: pending.scope.accountId, links: pending.links, shouldContinue: () => historyScopeCurrent(pending.scope) },
            })).then((result) => {
                if (result.historyRecorded) pendingHistory.delete(key);
                else syncReliabilityTelemetry.recordCritical('session.autoarchive.reason_not_recorded');
            }).finally(() => historyInFlight.delete(key));
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
        const canRetryHistory = [...pendingHistory.values()].some((pending) => historyScopeCurrent(pending.scope));
        if (!scope && !canRetryHistory) {
            if (checkTimer) clearTimeout(checkTimer);
            checkTimer = null;
            return;
        }
        if (!checkTimer) {
            checkTimer = setTimeout(() => {
                checkTimer = null;
                checked = new WeakSet();
                retryPendingHistory();
                scan();
            }, input.checkIntervalMs);
            (checkTimer as { unref?: () => void }).unref?.();
        }
        if (!scope) return;
        const state = storage.getState();
        for (const row of Object.values(state.sessionListRenderables)) {
            if (!row || checked.has(row)) continue;
            const decision = assessSessionAutoArchiveHydrationCandidate({
                session: row, enabled: true, archivePending: readSessionArchivePending(state, row.id, scope.serverId), accountId: scope.accountId,
            });
            if (!decision.eligible) continue;
            const key = `${nextScopeKey}:${row.id}`;
            if (inFlight.has(key)) continue;
            checked.add(row);
            inFlight.add(key);
            void candidateLimiter.run(() => attempt(scope, row))
                .catch(() => syncReliabilityTelemetry.record('session.autoarchive.candidate_failed'));
        }
    };

    const unsubscribe = storage.subscribe((state, previous) => {
        if (state.settings !== previous.settings || state.profileScope !== previous.profileScope) retryPendingHistory();
        if (state.sessionListRenderables !== previous.sessionListRenderables
            || state.settings !== previous.settings || state.profileScope !== previous.profileScope
            || state.settingsScope !== previous.settingsScope || state.sessionArchiveOperations !== previous.sessionArchiveOperations) scan();
    });
    scan();
    return {
        recheck: () => { checked = new WeakSet(); retryPendingHistory(); scan(); },
        dispose: () => { disposed = true; if (checkTimer) clearTimeout(checkTimer); unsubscribe(); },
    };
}
