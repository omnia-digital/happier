import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '../listing/sessionListRenderable';
import { assessSessionAutoArchiveCandidate, assessSessionAutoArchiveHydrationCandidate, assessVerifiedSessionPullRequests } from './sessionAutoArchiveEligibility';

const first = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/one', number: 7, url: 'https://github.com/owner/one/pull/7' };
const second = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/two', number: 7, url: 'https://github.com/owner/two/pull/7' };
const summary = (link: typeof first | typeof second, state: 'merged' | 'open' | 'closed' | 'unknown' = 'merged', draft: boolean | undefined = false) => ({
    provider: { kind: link.providerKind, name: 'GitHub', baseUrl: link.providerBaseUrl, nameWithOwner: link.repository },
    number: link.number, title: 'Review', url: link.url, baseBranch: 'main', headBranch: 'topic', state, draft,
});

function idleSession() {
    return { ...buildSessionListRenderableFromSession(createSessionFixture({
        metadata: { path: '/repo', host: 'host', sessionPullRequestsV1: { v: 1, links: [first, second] } },
    })), active: false, owner: 'account-a', presence: 1, pendingCount: 0, pendingBlockedCount: 0,
        thinking: false, runtimeActivityState: 'idle' as const, runtimeActivityActiveCount: 0,
        hasPendingPermissionRequests: false, hasPendingUserActionRequests: false,
    };
}

describe('session autoarchive eligibility', () => {
    it('projects persisted cross-repository links and ignores disabled or missing links', () => {
        const session = idleSession();
        expect(session.metadata?.sessionPullRequestsV1?.links).toEqual([first, second]);
        expect(assessSessionAutoArchiveCandidate({ session, enabled: false, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
        expect(assessSessionAutoArchiveCandidate({ session: { ...session, metadata: null }, enabled: true, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
        expect(assessSessionAutoArchiveCandidate({ session, enabled: true, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(true);
    });

    it('admits an inactive catalog shell to metadata-only hydration before links and live counts are known', () => {
        const session = idleSession();
        const cold = { ...session, metadata: null, metadataUnavailable: true };
        const warm = { ...session, metadata: { ...session.metadata!, agentActivityCounts: undefined } };
        expect(assessSessionAutoArchiveHydrationCandidate({ session: cold, enabled: true, archivePending: false, accountId: 'account-a' }).eligible).toBe(true);
        expect(assessSessionAutoArchiveHydrationCandidate({ session: warm, enabled: true, archivePending: false, accountId: 'account-a' }).eligible).toBe(true);
        expect(assessSessionAutoArchiveCandidate({ session: warm, enabled: true, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
        const shared = { ...session, owner: undefined, accessLevel: 'view' as const };
        expect(assessSessionAutoArchiveHydrationCandidate({ session: shared, enabled: true, archivePending: false, accountId: 'account-a' }).eligible).toBe(false);
        expect(assessSessionAutoArchiveCandidate({ session: shared, enabled: true, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
        expect(assessSessionAutoArchiveHydrationCandidate({ session: { ...cold, active: true }, enabled: true, archivePending: false, accountId: 'account-a' }).eligible).toBe(false);
    });

    it('skips active, live-host, pending, working, unknown and already-archived sessions', () => {
        const session = idleSession();
        const variants = [
            { active: true }, { presence: 'online' as const }, { pendingCount: 1 },
            { pendingCount: undefined }, { pendingBlockedCount: 1 }, { thinking: true },
            { runtimeActivityState: 'active' as const }, { runtimeActivityState: 'unknown' as const },
            { runtimeActivityState: null }, { runtimeActivityActiveCount: undefined },
            { runtimeActivityActiveCount: 1 }, { latestTurnStatus: 'in_progress' as const },
            { hasPendingPermissionRequests: true }, { hasPendingPermissionRequests: undefined },
            { hasPendingUserActionRequests: true }, { hasPendingUserActionRequests: undefined }, { archivedAt: 42 },
        ];
        for (const variant of variants) {
            expect(assessSessionAutoArchiveCandidate({ session: { ...session, ...variant }, enabled: true, archivePending: false, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
        }
        expect(assessSessionAutoArchiveCandidate({ session, enabled: true, archivePending: true, accountId: 'account-a', authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(false);
    });

    it('requires same-account authenticated ownership or an explicit admin share, never the UI owner convention', () => {
        const input = { session: idleSession(), enabled: true, archivePending: false, accountId: 'account-a' };
        expect(assessSessionAutoArchiveCandidate(input).eligible).toBe(false);
        expect(assessSessionAutoArchiveCandidate({ ...input, authenticatedOwnerAccountId: 'account-b' }).eligible).toBe(false);
        expect(assessSessionAutoArchiveCandidate({ ...input, authenticatedOwnerAccountId: 'account-a' }).eligible).toBe(true);
        for (const accessLevel of ['view', 'edit', 'admin'] as const) {
            expect(assessSessionAutoArchiveCandidate({ ...input, session: { ...input.session, owner: 'someone-else', accessLevel } }).eligible).toBe(accessLevel === 'admin');
        }
    });

    it('requires each exact qualified identity to have a fresh merged and explicitly non-draft result', () => {
        expect(assessVerifiedSessionPullRequests([first, second], [summary(first), summary(second)]).eligible).toBe(true);
        for (const unavailable of [null, summary(second, 'open'), summary(second, 'closed'), summary(second, 'unknown'), summary(second, 'merged', true), { ...summary(second), draft: undefined }]) {
            expect(assessVerifiedSessionPullRequests([first, second], [summary(first), unavailable]).eligible).toBe(false);
        }
        expect(assessVerifiedSessionPullRequests([first, second], [summary(first), summary(first)]).eligible).toBe(false);
        expect(assessVerifiedSessionPullRequests([first, second], [summary(first)]).eligible).toBe(false);
        expect(assessVerifiedSessionPullRequests([], []).eligible).toBe(false);
    });
});
