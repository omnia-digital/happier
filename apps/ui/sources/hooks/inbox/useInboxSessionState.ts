import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import * as React from 'react';
import { createSessionListRowStoreStateSelector } from '@/sync/store/sessionListRowStateSnapshot';

import {
    useSessionListViewDataByServerId,
} from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { StorageState } from '@/sync/store/types';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { createSessionSignatureLedger } from '@/activity/attention/sessionAttentionSignatureLedger';
import { buildStableJsonSignature } from '@/sync/domains/session/metadata/sessionMetadataStability';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    useSessionListRuntimeNowMs,
    useSessionListRuntimeWake,
} from '@/hooks/session/sessionListRuntimeClock';

import {
    buildInboxSessionState,
    buildInboxSessionSummary,
    resolveNextInboxSessionStateFreshnessAtMs,
    type InboxSessionState,
} from './buildInboxSessionState';

type InboxSessionSources = Readonly<{
    sessions: readonly Session[];
    sessionMessagesById: StorageState['sessionMessages'];
}>;

function readNumber(value: unknown): number | string {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : '';
}

export function buildInboxSessionSourceSignature(session: Session): string {
    return [
        session.id,
        session.serverId ?? '',
        readNumber(session.updatedAt),
        readNumber(session.metadataVersion),
        readNumber(session.agentStateVersion),
        readNumber(session.archivedAt),
        session.active === true ? 1 : 0,
        readNumber(session.activeAt),
        session.presence,
        session.thinking === true ? 1 : 0,
        readNumber(session.thinkingAt),
        session.latestTurnStatus ?? '',
        readNumber(session.latestTurnStatusObservedAt),
        readNumber(session.latestReadyEventAt),
        readNumber(session.meaningfulActivityAt),
        session.runtimeActivityState ?? '',
        readNumber(session.runtimeActivityActiveCount),
        readNumber(session.runtimeActivityObservedAt),
        readNumber(session.runtimeActivityRevision),
        readNumber(session.seq),
        readNumber(session.latestReadyEventSeq),
        readNumber(session.lastViewedSessionSeq),
        readNumber(session.pendingCount),
        readNumber(session.pendingPermissionRequestCount),
        readNumber(session.pendingUserActionRequestCount),
        readNumber(session.pendingRequestObservedAt),
        readNumber(session.pendingBlockedCount),
        buildStableJsonSignature(session.lastRuntimeIssue),
        session.accessLevel ?? '',
        session.canApprovePermissions === true ? 1 : 0,
        buildStableJsonSignature(session.metadata),
        buildStableJsonSignature(session.agentState),
    ].join('\u001f');
}

function buildInboxSessionMessagesSourceSignature(
    value: StorageState['sessionMessages'][string] | undefined,
): string {
    if (!value) return '';
    return [
        value.isLoaded === true ? 1 : 0,
        readNumber(value.messagesVersion),
        readNumber(value.agentEventSourceVersion),
        readNumber(value.latestReadyEventSeq),
        readNumber(value.latestReadyEventAt),
        value.messageIdsOldestFirst.join('\u001e'),
    ].join('\u001f');
}

function createInboxSessionSourcesSelector(): (state: StorageState) => InboxSessionSources {
    const sessionLedger = createSessionSignatureLedger<Session>(buildInboxSessionSourceSignature);
    const messagesLedger = createSessionSignatureLedger<StorageState['sessionMessages'][string] | undefined>(
        buildInboxSessionMessagesSourceSignature,
    );
    let previousRevision = '';
    let previous: InboxSessionSources = { sessions: [], sessionMessagesById: {} };

    return (state) => {
        const revision = [
            sessionLedger.sync(state.sessions, (id) => state.sessions[id]),
            messagesLedger.sync(state.sessions, (id) => state.sessionMessages[id]),
        ].join(':');
        if (revision === previousRevision) return previous;
        previousRevision = revision;
        previous = {
            sessions: Object.values(state.sessions).sort((left, right) => right.updatedAt - left.updatedAt),
            sessionMessagesById: state.sessionMessages,
        };
        return previous;
    };
}

const selectInboxSessionSources = createInboxSessionSourcesSelector();

export type InboxSessionSummary = Readonly<{
    hasContent: boolean;
    nextFreshnessAtMs: number | null;
}>;

type InboxSessionSummaryBuilder = typeof buildInboxSessionSummary;

type InboxSessionSourceBucket = {
    sessions: Session[];
    sessionListViewDataByServerId: Record<string, SessionListViewItem[]>;
};

type InboxSessionListItem = Extract<SessionListViewItem, Readonly<{ type: 'session' }>>;
type InboxSessionListItemIndex = Map<string, Map<string, InboxSessionListItem>>;

function buildInboxSessionListItemIndex(state: StorageState): InboxSessionListItemIndex {
    const index: InboxSessionListItemIndex = new Map();
    for (const [serverId, items] of Object.entries(state.sessionListViewDataByServerId)) {
        if (!items) continue;
        for (const item of items) {
            if (item.type !== 'session') continue;
            const sessionId = item.session.id;
            let byServerId = index.get(sessionId);
            if (!byServerId) {
                byServerId = new Map();
                index.set(sessionId, byServerId);
            }
            byServerId.set(serverId, item);
        }
    }
    return index;
}

function collectInboxSessionSourceBuckets(
    state: StorageState,
    listItemIndex: InboxSessionListItemIndex,
    selectedIds?: ReadonlySet<string>,
): ReadonlyMap<string, InboxSessionSourceBucket> {
    const ids = selectedIds ?? new Set([...Object.keys(state.sessions), ...listItemIndex.keys()]);
    const buckets = new Map<string, InboxSessionSourceBucket>();
    for (const sessionId of ids) {
        const session = state.sessions[sessionId];
        const byServerId = listItemIndex.get(sessionId);
        if (!session && !byServerId) continue;
        const sessionListViewDataByServerId: Record<string, SessionListViewItem[]> = {};
        if (byServerId) {
            for (const [serverId, item] of byServerId) {
                sessionListViewDataByServerId[serverId] = [item];
            }
        }
        // The session-list renderable is already the canonical, transcript-aware projection for
        // a list member. Feeding the hydrated session beside it makes the shared Inbox builder
        // discard that projection and rebuild it from metadata, agent state and messages just to
        // answer the closed-surface boolean. Keep hydrated fallback work only for sessions that
        // have no list projection; the focused Inbox model still consumes full session detail.
        const hasProjectedListMember = byServerId !== undefined && byServerId.size > 0;
        buckets.set(sessionId, {
            sessions: session && !hasProjectedListMember ? [session] : [],
            sessionListViewDataByServerId,
        });
    }
    return buckets;
}

function applyInboxSessionListItemDelta(
    state: StorageState,
    index: InboxSessionListItemIndex,
    previousDataByServerId: StorageState['sessionListViewDataByServerId'],
    changedSessionIds: readonly string[],
    removedSessionIds: readonly string[],
): boolean {
    const changedServerIds = new Set<string>();
    for (const serverId of new Set([
        ...Object.keys(previousDataByServerId),
        ...Object.keys(state.sessionListViewDataByServerId),
    ])) {
        if (previousDataByServerId[serverId] !== state.sessionListViewDataByServerId[serverId]) {
            changedServerIds.add(serverId);
        }
    }
    for (const sessionId of removedSessionIds) {
        const existing = index.get(sessionId);
        if (!existing || changedServerIds.size === 0) continue;
        for (const serverId of changedServerIds) existing.delete(serverId);
        if (existing.size === 0) index.delete(sessionId);
    }
    for (const sessionId of changedSessionIds) {
        const renderable = state.sessionListRenderables[sessionId];
        const existing = index.get(sessionId);
        if (!renderable) {
            if (existing) return false;
            continue;
        }
        if (existing && existing.size > 0 && changedServerIds.size > 0) {
            const changedExistingServerIds = [...changedServerIds].filter((serverId) => existing.has(serverId));
            if (changedExistingServerIds.length !== 1) return false;
            const [changedServerId] = changedExistingServerIds;
            const hydratedServerId = state.sessions[sessionId]?.serverId?.trim() || null;
            // The global renderable record is keyed only by session id. When two
            // Homes use the same id, it belongs to the hydrated session's Home
            // and cannot safely replace a different server's cached row. Fall
            // back to rebuilding from the server-scoped list data in that case.
            if (
                existing.size > 1
                && (
                    !hydratedServerId
                    || !areServerProfileIdentifiersEquivalent(hydratedServerId, changedServerId)
                )
            ) {
                return false;
            }
            const item = existing.get(changedServerId);
            if (!item) return false;
            existing.set(changedServerId, { ...item, session: renderable });
            continue;
        }
        const serverId = state.sessions[sessionId]?.serverId?.trim();
        if (!serverId || (changedServerIds.size > 0 && !changedServerIds.has(serverId))) return false;
        index.set(sessionId, new Map([[serverId, {
            type: 'session',
            serverId,
            session: renderable,
        }]]));
    }
    return true;
}

/**
 * Builds the always-mounted Inbox summary without subscribing navigation chrome
 * to the detailed Inbox model. Source-identity reuse makes unrelated store waves
 * O(1); renderable deltas and signature-ledger changes reclassify only affected
 * session ids through the canonical Inbox summary builder.
 */
export function createInboxSessionSummarySelector(
    initialNowMs: number = Date.now(),
    buildSummary: InboxSessionSummaryBuilder = buildInboxSessionSummary,
): (state: StorageState, nowMs?: number, activeServerId?: string) => InboxSessionSummary {
    const sessionLedger = createSessionSignatureLedger<Session>(buildInboxSessionSourceSignature);
    const messagesLedger = createSessionSignatureLedger<StorageState['sessionMessages'][string] | undefined>(
        buildInboxSessionMessagesSourceSignature,
    );
    const contributionBySessionId = new Map<string, InboxSessionSummary>();
    let listItemIndex: InboxSessionListItemIndex = new Map();
    let contentContributionCount = 0;
    let minimumFreshnessAtMs: number | null = null;
    let previousSessions: StorageState['sessions'] | null = null;
    let previousSessionMessages: StorageState['sessionMessages'] | null = null;
    let previousSessionListViewDataByServerId: StorageState['sessionListViewDataByServerId'] | null = null;
    let previousDeltaRevision: number | null = null;
    let previous: InboxSessionSummary | null = null;
    let previousNowMs: number | null = null;
    let previousActiveServerId: string | null = null;

    const evaluateBuckets = (
        state: StorageState,
        buckets: ReadonlyMap<string, InboxSessionSourceBucket>,
        nowMs: number,
        activeServerId: string,
        replacedIds?: ReadonlySet<string>,
    ) => {
        let minimumNeedsRebuild = false;
        if (!replacedIds) {
            contributionBySessionId.clear();
            contentContributionCount = 0;
            minimumFreshnessAtMs = null;
        } else {
            for (const sessionId of replacedIds) {
                const previousContribution = contributionBySessionId.get(sessionId);
                if (previousContribution?.hasContent) contentContributionCount -= 1;
                if (
                    previousContribution?.nextFreshnessAtMs !== null
                    && previousContribution?.nextFreshnessAtMs === minimumFreshnessAtMs
                ) {
                    minimumNeedsRebuild = true;
                }
                contributionBySessionId.delete(sessionId);
            }
        }
        for (const [sessionId, bucket] of buckets) {
            const contribution = buildSummary({
                sessions: bucket.sessions,
                sessionListViewDataByServerId: bucket.sessionListViewDataByServerId,
                sessionMessagesById: state.sessionMessages,
                activeServerId,
                nowMs,
            });
            contributionBySessionId.set(sessionId, contribution);
            if (contribution.hasContent) contentContributionCount += 1;
            if (contribution.nextFreshnessAtMs !== null) {
                minimumFreshnessAtMs = minimumFreshnessAtMs === null
                    ? contribution.nextFreshnessAtMs
                    : Math.min(minimumFreshnessAtMs, contribution.nextFreshnessAtMs);
            }
        }
        if (minimumNeedsRebuild) {
            minimumFreshnessAtMs = null;
            for (const contribution of contributionBySessionId.values()) {
                if (contribution.nextFreshnessAtMs === null) continue;
                minimumFreshnessAtMs = minimumFreshnessAtMs === null
                    ? contribution.nextFreshnessAtMs
                    : Math.min(minimumFreshnessAtMs, contribution.nextFreshnessAtMs);
            }
        }
    };

    return (state, nowMs = initialNowMs, activeServerId = getActiveServerSnapshot().serverId) => {
        const delta = state.sessionListRenderableDelta;
        const deltaRevision = delta?.revision ?? null;
        const clockMovedBackward = previousNowMs !== null && nowMs < previousNowMs;
        const expiredIds = new Set<string>();
        if (
            previous !== null
            && minimumFreshnessAtMs !== null
            && nowMs >= minimumFreshnessAtMs
        ) {
            for (const [sessionId, contribution] of contributionBySessionId) {
                if (
                    contribution.nextFreshnessAtMs !== null
                    && nowMs >= contribution.nextFreshnessAtMs
                ) {
                    expiredIds.add(sessionId);
                }
            }
        }
        if (
            previous !== null
            && previousActiveServerId === activeServerId
            && !clockMovedBackward
            && expiredIds.size === 0
            && state.sessions === previousSessions
            && state.sessionMessages === previousSessionMessages
            && state.sessionListViewDataByServerId === previousSessionListViewDataByServerId
            && deltaRevision === previousDeltaRevision
        ) {
            previousNowMs = nowMs;
            return previous;
        }

        const sessionListViewDataChanged = state.sessionListViewDataByServerId !== previousSessionListViewDataByServerId;
        const deltaAdvanced = delta !== undefined && deltaRevision !== previousDeltaRevision;
        const usableDelta = deltaAdvanced && delta?.rebuiltSessionListViewData !== true;
        let requiresFullRebuild = previous === null
            || previousActiveServerId !== activeServerId
            || clockMovedBackward
            || (sessionListViewDataChanged && (!deltaAdvanced || delta?.rebuiltSessionListViewData === true));

        const changedIds = expiredIds;
        if (requiresFullRebuild) {
            sessionLedger.sync(state.sessions, (id) => state.sessions[id]);
            messagesLedger.sync(state.sessions, (id) => state.sessionMessages[id]);
            listItemIndex = buildInboxSessionListItemIndex(state);
        } else {
            if (state.sessions !== previousSessions && !usableDelta) {
                sessionLedger.sync(state.sessions, (id) => state.sessions[id]);
                for (const sessionId of sessionLedger.readChangedIds()) changedIds.add(sessionId);
            }
            if (state.sessionMessages !== previousSessionMessages) {
                messagesLedger.sync(state.sessions, (id) => state.sessionMessages[id]);
                for (const sessionId of messagesLedger.readChangedIds()) changedIds.add(sessionId);
            }
            if (usableDelta && delta) {
                for (const sessionId of delta.changedSessionIds) changedIds.add(sessionId);
                for (const sessionId of delta.removedSessionIds) changedIds.add(sessionId);
                if (!applyInboxSessionListItemDelta(
                    state,
                    listItemIndex,
                    previousSessionListViewDataByServerId ?? {},
                    delta.changedSessionIds,
                    delta.removedSessionIds,
                )) {
                    requiresFullRebuild = true;
                    sessionLedger.sync(state.sessions, (id) => state.sessions[id]);
                    messagesLedger.sync(state.sessions, (id) => state.sessionMessages[id]);
                    listItemIndex = buildInboxSessionListItemIndex(state);
                }
            }
        }

        if (requiresFullRebuild) {
            evaluateBuckets(state, collectInboxSessionSourceBuckets(state, listItemIndex), nowMs, activeServerId);
        } else if (changedIds.size > 0) {
            evaluateBuckets(
                state,
                collectInboxSessionSourceBuckets(state, listItemIndex, changedIds),
                nowMs,
                activeServerId,
                changedIds,
            );
        }

        previousSessions = state.sessions;
        previousSessionMessages = state.sessionMessages;
        previousSessionListViewDataByServerId = state.sessionListViewDataByServerId;
        previousDeltaRevision = deltaRevision;
        previousNowMs = nowMs;
        previousActiveServerId = activeServerId;
        const next: InboxSessionSummary = {
            hasContent: contentContributionCount > 0,
            nextFreshnessAtMs: minimumFreshnessAtMs,
        };
        if (
            previous !== null
            && previous.hasContent === next.hasContent
            && previous.nextFreshnessAtMs === next.nextFreshnessAtMs
        ) {
            return previous;
        }
        previous = next;
        return next;
    };
}

export function useInboxSessionSummary(): InboxSessionSummary {
    const { serverId: activeServerId } = useActiveServerSnapshot();
    const nowMs = useSessionListRuntimeNowMs();
    const summarySelector = React.useMemo(() => createInboxSessionSummarySelector(), []);
    const selector = React.useCallback(
        (state: StorageState) => summarySelector(state, nowMs, activeServerId),
        [nowMs, summarySelector, activeServerId],
    );
    const summary = storage(selector);
    useSessionListRuntimeWake(summary.nextFreshnessAtMs);
    return summary;
}

/**
 * Canonical mounted Inbox session-state composition.
 *
 * Focused Inbox screens and open Inbox popovers consume this detailed state.
 * Navigation chrome uses the summary selector above, and both delegate their
 * attention decisions to the same canonical Inbox builder. Freshness wakes use
 * the shared session runtime clock.
 */
export function useInboxSessionState(): InboxSessionState {
    const { sessions, sessionMessagesById } = storage(selectInboxSessionSources);
    const sessionListViewDataByServerId = useSessionListViewDataByServerId();
    const { serverId: activeServerId } = useActiveServerSnapshot();
    const selectLiveRenderables = React.useMemo(() => {
        const scopes = Object.entries(sessionListViewDataByServerId).flatMap(([serverId, items]) =>
            (items ?? []).flatMap(item => item.type === 'session' ? [{ serverId, sessionId: item.session.id }] : []));
        const selectRows = createSessionListRowStoreStateSelector(scopes, activeServerId);
        // Reuse the row owner's locality and progress-only reuse policy. The open Inbox needs
        // current request/status changes, not a rebuild for unrelated or unchanged list rows.
        return (state: StorageState) => selectRows({ sessionListRenderables: state.sessionListRenderables }).sessionListRenderables;
    }, [sessionListViewDataByServerId, activeServerId]);
    const sessionListRenderables = storage(selectLiveRenderables);
    const nowMs = useSessionListRuntimeNowMs();

    const nextFreshnessAtMs = React.useMemo(
        () => resolveNextInboxSessionStateFreshnessAtMs({
            sessions,
            sessionListViewDataByServerId,
            sessionMessagesById,
            sessionListRenderables,
            activeServerId,
            nowMs,
        }),
        [nowMs, sessionListViewDataByServerId, sessionMessagesById, sessions, sessionListRenderables, activeServerId],
    );
    useSessionListRuntimeWake(nextFreshnessAtMs);

    return React.useMemo(
        () => buildInboxSessionState({
            sessions,
            sessionListViewDataByServerId,
            sessionMessagesById,
            sessionListRenderables,
            activeServerId,
            nowMs,
        }),
        [nowMs, sessionListViewDataByServerId, sessionMessagesById, sessions, sessionListRenderables, activeServerId],
    );
}
