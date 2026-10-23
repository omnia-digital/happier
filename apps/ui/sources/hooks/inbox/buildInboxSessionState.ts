import { selectSessionListRowStateSnapshot } from '@/sync/store/sessionListRowStateSnapshot';
import { isSessionHydrationRevisionCurrent } from '@/sync/domains/session/listing/sessionHydrationFreshness';
import type { Session } from '@/sync/domains/state/storageTypes';
import { listPendingPermissionRequests, listPendingUserActionRequests, type PendingPermissionRequest } from '@/utils/sessions/sessionUtils';
import {
    buildSessionListRenderableFromSession,
    type SessionListRenderableSession,
} from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import {
    resolveNextSessionRuntimePresentationFreshnessAtMs,
    type DeriveSessionRuntimePresentationStateInput,
} from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { readStoredSessionMessagesFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import type { StorageState } from '@/sync/store/types';
import type { SessionBulkActionTarget } from '@/components/sessions/actions/sessionBulkActionTypes';
import { normalizeSessionListKeyParts } from '@/sync/domains/session/listing/sessionListKeyNormalization';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    projectSessionListPlacement,
    type SessionListPlacementKind,
} from '@/sync/domains/session/listing/placement/sessionListPlacementProjection';

export type InboxActionRequiredReason = Extract<
    SessionListPlacementKind,
    'action_required' | 'permission_required'
> | 'delivery_blocked';

export type InboxReviewReason = Extract<SessionListPlacementKind, 'ready' | 'failed'>;

export type InboxSessionAttentionEntry = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
    reason: InboxActionRequiredReason;
    pendingPermissions: readonly PendingPermissionRequest[];
    pendingUserActions: readonly PendingPermissionRequest[];
}>;

export type InboxAttentionSession = Session | SessionListRenderableSession;
export type InboxReviewSessionEntry = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
    reason: InboxReviewReason;
}>;

export type InboxSessionState = Readonly<{
    reviewSessions: InboxReviewSessionEntry[];
    sessionsNeedingAttention: InboxSessionAttentionEntry[];
    markAllReadTargets: SessionBulkActionTarget[];
    sessionByKey: ReadonlyMap<string, Readonly<{
        serverId: string | null;
        sessionId: string;
        session: InboxAttentionSession;
    }>>;
}>;

export type InboxSessionSummary = Readonly<{
    hasContent: boolean;
    nextFreshnessAtMs: number | null;
}>;

type BuildInboxSessionStateInput =
    | readonly Session[]
    | Readonly<{
        sessions: readonly Session[];
        sessionListViewDataByServerId?: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
        sessionMessagesById?: StorageState['sessionMessages'];
        sessionListRenderables?: Readonly<Record<string, SessionListRenderableSession | undefined>>;
        activeServerId?: string | null;
        nowMs?: number;
    }>;

function normalizeBuildInboxSessionStateInput(input: BuildInboxSessionStateInput): Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionMessagesById?: StorageState['sessionMessages'];
    sessionListRenderables?: Readonly<Record<string, SessionListRenderableSession | undefined>>;
    activeServerId?: string | null;
    nowMs: number;
}> {
    if ('sessions' in input) {
        return {
            sessions: input.sessions,
            sessionListViewDataByServerId: input.sessionListViewDataByServerId ?? {},
            sessionMessagesById: input.sessionMessagesById,
            sessionListRenderables: input.sessionListRenderables,
            activeServerId: input.activeServerId,
            nowMs: typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now(),
        };
    }
    return { sessions: input, sessionListViewDataByServerId: {}, nowMs: Date.now() };
}

type InboxSessionAddress = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
}>;

type InboxSessionCandidateEntry = Readonly<{
    key: string;
    serverId: string | null;
    sessionId: string;
    session: InboxAttentionSession;
}>;

function buildInboxSessionAddress(serverIdRaw: unknown, sessionIdRaw: unknown): InboxSessionAddress | null {
    const parts = normalizeSessionListKeyParts(serverIdRaw, sessionIdRaw);
    if (!parts.sessionId) return null;
    return {
        key: parts.sessionKey ?? parts.sessionId,
        serverId: parts.serverId || null,
        sessionId: parts.sessionId,
    };
}

function indexSessionsById(sessions: readonly Session[]): ReadonlyMap<string, readonly Session[]> {
    const sessionsById = new Map<string, Session[]>();
    for (const session of sessions) {
        const existing = sessionsById.get(session.id);
        if (existing) {
            existing.push(session);
        } else {
            sessionsById.set(session.id, [session]);
        }
    }
    return sessionsById;
}

function findScopedSession(
    sessionsById: ReadonlyMap<string, readonly Session[]>,
    address: InboxSessionAddress,
): Session | null {
    if (!address.serverId) return null;
    return sessionsById.get(address.sessionId)?.find((session) => (
        Boolean(session.serverId)
        && areServerProfileIdentifiersEquivalent(session.serverId, address.serverId)
    )) ?? null;
}

function collectInboxSessionEntries(params: Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionListRenderables?: Readonly<Record<string, SessionListRenderableSession | undefined>>;
    activeServerId?: string | null;
}>): InboxSessionCandidateEntry[] {
    const entries: InboxSessionCandidateEntry[] = [];
    const seenKeys = new Set<string>();
    const scopedCacheSessionIds = new Set<string>();
    const matchedHydratedSessions = new Set<Session>();
    const sessionsById = indexSessionsById(params.sessions);

    for (const [recordServerId, items] of Object.entries(params.sessionListViewDataByServerId)) {
        const serverParts = normalizeSessionListKeyParts(recordServerId);
        if (!serverParts.serverId || !items) continue;
        for (const item of items) {
            if (item.type !== 'session') continue;
            const address = buildInboxSessionAddress(serverParts.serverId, item.session.id);
            if (!address || seenKeys.has(address.key)) continue;
            seenKeys.add(address.key);
            scopedCacheSessionIds.add(address.sessionId);
            const canonicalSession = findScopedSession(sessionsById, address);
            // Embedded list rows deliberately retain structural snapshots. Read live status from
            // the same scoped overlay as session cards; foreign Homes keep their own cached row.
            const listSession = params.activeServerId ? selectSessionListRowStateSnapshot({
                activeServerId: params.activeServerId, sessionListRenderables: params.sessionListRenderables,
            }, address).renderable ?? item.session : item.session;
            if (canonicalSession) matchedHydratedSessions.add(canonicalSession);
            const session = canonicalSession && isSessionHydrationRevisionCurrent(canonicalSession, listSession)
                ? canonicalSession
                : listSession;
            if (session.archivedAt != null) continue;
            entries.push({ ...address, session });
        }
    }

    for (const session of params.sessions) {
        if (matchedHydratedSessions.has(session)) continue;
        const address = buildInboxSessionAddress(session.serverId, session.id);
        if (!address || seenKeys.has(address.key)) continue;
        // A server-qualified list row is the only safe source of Home identity.
        // Do not append a bare-id hydrated fallback beside it: the global hydrated
        // map may currently belong to a different Home after a background commit.
        if (!address.serverId && scopedCacheSessionIds.has(address.sessionId)) continue;
        seenKeys.add(address.key);
        if (session.archivedAt != null) continue;
        entries.push({ ...address, session });
    }

    return entries;
}

function readMessagesForInboxSession(
    sessionMessagesById: StorageState['sessionMessages'] | undefined,
    entry: InboxSessionAddress,
    activeServerId?: string | null,
) {
    if (!sessionMessagesById) return undefined;
    const messages = activeServerId ? selectSessionListRowStateSnapshot({
        activeServerId, sessionMessages: sessionMessagesById,
    }, entry).messages : sessionMessagesById[entry.sessionId];
    return messages ? readStoredSessionMessagesFromStateLike(messages) : undefined;
}

function buildPendingInboxRuntimeInput(params: Readonly<{
    session: InboxAttentionSession;
    pendingPermissions: readonly PendingPermissionRequest[];
    pendingUserActions: readonly PendingPermissionRequest[];
}>): DeriveSessionRuntimePresentationStateInput {
    const projectedPendingPermissions = 'agentState' in params.session
        ? params.pendingPermissions.length > 0
        : params.session.hasPendingPermissionRequests === true;
    const projectedPendingUserActions = 'agentState' in params.session
        ? params.pendingUserActions.length > 0
        : params.session.hasPendingUserActionRequests === true;
    return {
        active: params.session.active,
        activeAt: params.session.activeAt,
        archivedAt: params.session.archivedAt,
        presence: params.session.presence,
        thinking: params.session.thinking,
        thinkingAt: params.session.thinkingAt,
        latestTurnStatus: params.session.latestTurnStatus,
        latestTurnStatusObservedAt: params.session.latestTurnStatusObservedAt,
        latestReadyEventAt: params.session.latestReadyEventAt,
        runtimeActivityState: params.session.runtimeActivityState,
        runtimeActivityActiveCount: params.session.runtimeActivityActiveCount,
        runtimeActivityObservedAt: params.session.runtimeActivityObservedAt,
        runtimeActivityRevision: params.session.runtimeActivityRevision,
        meaningfulActivityAt: params.session.meaningfulActivityAt,
        hasPendingPermissionRequests: projectedPendingPermissions,
        hasPendingUserActionRequests: projectedPendingUserActions,
        pendingRequestObservedAt: 'agentState' in params.session
            ? latestPendingRequestObservedAt([
                ...params.pendingPermissions,
                ...params.pendingUserActions,
            ])
            : params.session.pendingRequestObservedAt ?? null,
    };
}

function latestPendingRequestObservedAt(requests: readonly PendingPermissionRequest[]): number | null {
    let latest: number | null = null;
    for (const request of requests) {
        const createdAt = request.createdAt;
        if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) continue;
        latest = latest === null ? createdAt : Math.max(latest, createdAt);
    }
    return latest;
}

function evaluateInboxSessionCandidate(params: Readonly<{
    entry: InboxSessionCandidateEntry;
    sessionMessagesById?: StorageState['sessionMessages'];
    activeServerId?: string | null;
    nowMs: number;
}>) {
    const { entry } = params;
    if (!isUserFacingSession(entry.session)) return null;
    const isHydrated = 'agentState' in entry.session;
    const messages = isHydrated
        ? readMessagesForInboxSession(params.sessionMessagesById, entry, params.activeServerId)
        : undefined;
    const pendingPermissions = isHydrated
        ? listPendingPermissionRequests(entry.session, messages)
        : [];
    const pendingUserActions = isHydrated
        ? listPendingUserActionRequests(entry.session, messages)
        : [];
    const renderable = isHydrated
        ? buildSessionListRenderableFromSession(entry.session, messages)
        : entry.session;
    const placement = projectSessionListPlacement({
        session: renderable,
        sessionKey: entry.key,
        nowMs: params.nowMs,
    });
    const runtimeInput = buildPendingInboxRuntimeInput({
        session: entry.session,
        pendingPermissions,
        pendingUserActions,
    });
    return {
        pendingPermissions,
        pendingUserActions,
        renderable,
        placement,
        runtimeInput,
    };
}

export function buildInboxSessionState(input: BuildInboxSessionStateInput): InboxSessionState {
    const normalized = normalizeBuildInboxSessionStateInput(input);
    const { sessionMessagesById, nowMs } = normalized;
    const sessionsNeedingAttention: InboxSessionAttentionEntry[] = [];
    const candidates = collectInboxSessionEntries(normalized);
    const sessionByKey = new Map(candidates.map((entry) => [entry.key, {
        serverId: entry.serverId,
        sessionId: entry.sessionId,
        session: entry.session,
    }] as const));

    const reviewSessions: InboxReviewSessionEntry[] = [];
    const markAllReadTargets: SessionBulkActionTarget[] = [];
    for (const entry of candidates) {
        const evaluation = evaluateInboxSessionCandidate({
            entry,
            sessionMessagesById,
            activeServerId: normalized.activeServerId,
            nowMs,
        });
        if (!evaluation) continue;
        const {
            pendingPermissions,
            pendingUserActions,
            renderable,
            placement,
        } = evaluation;

        if (placement.kind === 'permission_required' || placement.kind === 'action_required') {
            sessionsNeedingAttention.push({
                key: entry.key,
                serverId: entry.serverId,
                sessionId: entry.sessionId,
                session: entry.session,
                reason: placement.attentionSource === 'blocked_delivery' ? 'delivery_blocked' : placement.kind,
                pendingPermissions,
                pendingUserActions,
            });
            continue;
        }

        // Inbox is the review/action surface, not a second unread feed. The session
        // list projection already owns precedence between working, completion,
        // failure and raw unread state. Only terminal review placements belong here;
        // plain unread and working remain in the session list until a turn completes.
        if (placement.kind !== 'ready' && placement.kind !== 'failed') continue;
        reviewSessions.push({ ...entry, reason: placement.kind });
        if (placement.kind === 'ready' && renderable.hasUnreadMessages === true) {
            markAllReadTargets.push({
                key: entry.key,
                sessionId: entry.sessionId,
                serverId: entry.serverId,
                readState: 'unread',
            });
        }
    }

    return {
        reviewSessions,
        sessionsNeedingAttention,
        markAllReadTargets,
        sessionByKey,
    };
}

export function hasInboxSessionContent(input: BuildInboxSessionStateInput): boolean {
    return buildInboxSessionSummary(input).hasContent;
}

function buildInboxSessionSummaryFromNormalizedInput(input: Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionMessagesById?: StorageState['sessionMessages'];
    sessionListRenderables?: Readonly<Record<string, SessionListRenderableSession | undefined>>;
    activeServerId?: string | null;
    nowMs: number;
}>): InboxSessionSummary {
    let hasContent = false;
    let nextFreshnessAtMs: number | null = null;
    const candidates = collectInboxSessionEntries({
        sessions: input.sessions,
        sessionListViewDataByServerId: input.sessionListViewDataByServerId,
        sessionListRenderables: input.sessionListRenderables,
        activeServerId: input.activeServerId,
    });
    for (const entry of candidates) {
        const evaluation = evaluateInboxSessionCandidate({
            entry,
            sessionMessagesById: input.sessionMessagesById,
            activeServerId: input.activeServerId,
            nowMs: input.nowMs,
        });
        if (!evaluation) continue;
        const { kind } = evaluation.placement;
        if (
            kind === 'permission_required'
            || kind === 'action_required'
            || kind === 'ready'
            || kind === 'failed'
        ) {
            hasContent = true;
        }
        const freshnessAtMs = resolveNextSessionRuntimePresentationFreshnessAtMs(
            evaluation.runtimeInput,
            input.nowMs,
        );
        if (freshnessAtMs === null) continue;
        nextFreshnessAtMs = nextFreshnessAtMs === null
            ? freshnessAtMs
            : Math.min(nextFreshnessAtMs, freshnessAtMs);
    }
    return { hasContent, nextFreshnessAtMs };
}

export function buildInboxSessionSummary(input: BuildInboxSessionStateInput): InboxSessionSummary {
    return buildInboxSessionSummaryFromNormalizedInput(normalizeBuildInboxSessionStateInput(input));
}

export function resolveNextInboxSessionStateFreshnessAtMs(input: Readonly<{
    sessions: readonly Session[];
    sessionListViewDataByServerId?: Readonly<Record<string, readonly SessionListViewItem[] | null>>;
    sessionMessagesById?: StorageState['sessionMessages'];
    sessionListRenderables?: Readonly<Record<string, SessionListRenderableSession | undefined>>;
    activeServerId?: string | null;
    nowMs: number;
}>): number | null {
    return buildInboxSessionSummaryFromNormalizedInput({
        sessions: input.sessions,
        sessionListViewDataByServerId: input.sessionListViewDataByServerId ?? {},
        sessionMessagesById: input.sessionMessagesById,
        sessionListRenderables: input.sessionListRenderables,
        activeServerId: input.activeServerId,
        nowMs: input.nowMs,
    }).nextFreshnessAtMs;
}
