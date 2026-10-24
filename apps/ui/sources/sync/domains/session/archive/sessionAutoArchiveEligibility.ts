import {
    readSessionPullRequestLinks,
    sessionPullRequestLinkFromSummary,
    sessionPullRequestLinkKey,
    type ScmPullRequestSummary,
    type SessionPullRequestLinkV1,
} from '@happier-dev/protocol';
import type { SessionListRenderableSession } from '../listing/sessionListRenderable';

export type SessionAutoArchiveAssessment = Readonly<{
    eligible: boolean;
    reason: 'disabled' | 'archived' | 'metadata_unavailable' | 'no_links' | 'work_unverified' | 'archive_pending'
        | 'pr_unavailable' | 'pr_not_merged' | 'pr_identity_mismatch' | 'pr_draft_unknown' | 'ready';
}>;

const skip = (reason: Exclude<SessionAutoArchiveAssessment['reason'], 'ready'>): SessionAutoArchiveAssessment => ({ eligible: false, reason });

type CandidateInput = Readonly<{
    session: SessionListRenderableSession;
    enabled: boolean;
    archivePending: boolean;
    accountId?: string;
    authenticatedOwnerAccountId?: string;
}>;

/** Catalog-only gate for bounded metadata hydration after explicit opt-in. */
export function assessSessionAutoArchiveHydrationCandidate(input: CandidateInput): SessionAutoArchiveAssessment {
    const session = input.session;
    if (!input.enabled) return skip('disabled');
    if (session.archivedAt != null) return skip('archived');
    if (input.archivePending) return skip('archive_pending');
    if (session.accessLevel === 'view' || session.accessLevel === 'edit') return skip('work_unverified');
    if (session.active !== false || typeof session.presence !== 'number' || !Number.isFinite(session.presence)
        || session.thinking !== false || session.pendingCount !== 0 || session.pendingBlockedCount !== 0
        || session.runtimeActivityState !== 'idle' || session.runtimeActivityActiveCount !== 0
        || session.latestTurnStatus === 'in_progress' || session.pendingActivationAuthorization != null
        || session.hasPendingPermissionRequests !== false || session.hasPendingUserActionRequests !== false) return skip('work_unverified');
    return { eligible: true, reason: 'ready' };
}

/** Final local gate after metadata-only hydration; no provider read is attempted before this. */
export function assessSessionAutoArchiveCandidate(input: CandidateInput): SessionAutoArchiveAssessment {
    const base = assessSessionAutoArchiveHydrationCandidate(input);
    if (!base.eligible) return base;
    const session = input.session;
    // Manual UI's absent-role convention and the shared-owner display field are not ownership proof.
    if (session.accessLevel !== 'admin' && (!input.accountId || input.authenticatedOwnerAccountId !== input.accountId)) return skip('work_unverified');
    if (session.metadataUnavailable || !session.metadata) return skip('metadata_unavailable');
    if (readSessionPullRequestLinks(session.metadata).length === 0) return skip('no_links');
    if (session.metadata.agentActivityCounts?.live !== 0) return skip('work_unverified');
    return { eligible: true, reason: 'ready' };
}

/** Results must be from exact fresh provider gets; a persisted or open-list status is never supplied here. */
export function assessVerifiedSessionPullRequests(
    links: readonly SessionPullRequestLinkV1[],
    freshResults: readonly (ScmPullRequestSummary | null)[],
): SessionAutoArchiveAssessment {
    if (links.length === 0) return skip('no_links');
    if (links.length !== freshResults.length) return skip('pr_unavailable');
    for (let i = 0; i < links.length; i++) {
        const result = freshResults[i];
        if (!result) return skip('pr_unavailable');
        const returned = sessionPullRequestLinkFromSummary(result);
        if (!returned || sessionPullRequestLinkKey(returned) !== sessionPullRequestLinkKey(links[i]!)) return skip('pr_identity_mismatch');
        if (result.state !== 'merged') return skip('pr_not_merged');
        if (result.draft !== false) return skip('pr_draft_unknown');
    }
    return { eligible: true, reason: 'ready' };
}
