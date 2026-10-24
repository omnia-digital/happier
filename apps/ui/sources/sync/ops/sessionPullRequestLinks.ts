import {
    appendSessionPullRequestLink,
    removeSessionPullRequestLink,
    sessionPullRequestLinkFromSummary,
    sessionPullRequestLinkFromUrl,
    sessionPullRequestLinkKey,
    type ScmPullRequestSummary,
    type SessionPullRequestLinkV1,
} from '@happier-dev/protocol';

import { storage } from '@/sync/domains/state/storage';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { sessionScmPullRequestGet } from '@/sync/ops/sessionScm';

export function captureSessionPullRequestActionScope(sessionId: string, isActionCurrent?: () => boolean) {
    const state = storage.getState();
    const scope = state.profileScope;
    const session = state.sessions[sessionId];
    if (!scope || !session || (session.serverId && session.serverId !== scope.serverId)) {
        throw new Error('Session account or server is unavailable for pull request links.');
    }
    const shouldContinue = () => {
        const current = storage.getState();
        return (isActionCurrent?.() ?? true)
            && current.profileScope?.accountId === scope.accountId
            && current.profileScope?.serverId === scope.serverId
            && current.sessions[sessionId]?.serverId === session.serverId;
    };
    return { serverId: scope.serverId, accountId: scope.accountId, shouldContinue };
}
export type SessionPullRequestActionScope = ReturnType<typeof captureSessionPullRequestActionScope>;

function requireCurrentScope(sessionId: string, captured?: SessionPullRequestActionScope): SessionPullRequestActionScope {
    const scope = captured ?? captureSessionPullRequestActionScope(sessionId);
    if (!scope.shouldContinue()) throw new Error('The session Home account or action changed before saving this pull request link.');
    return scope;
}

export async function addSessionPullRequestLink(sessionId: string, link: SessionPullRequestLinkV1, captured?: SessionPullRequestActionScope): Promise<void> {
    const scope = requireCurrentScope(sessionId, captured);
    await getSyncSingleton().patchSessionMetadataWithRetry(sessionId, (metadata) => appendSessionPullRequestLink(metadata, link), scope);
    if (!scope.shouldContinue()) throw new Error('The session Home account or action changed before saving this pull request link.');
}

export async function removeLinkedPullRequest(sessionId: string, link: SessionPullRequestLinkV1, captured?: SessionPullRequestActionScope): Promise<void> {
    const scope = requireCurrentScope(sessionId, captured);
    await getSyncSingleton().patchSessionMetadataWithRetry(sessionId, (metadata) => removeSessionPullRequestLink(metadata, link), scope);
    if (!scope.shouldContinue()) throw new Error('The session Home account or action changed before removing this pull request link.');
}

export async function replaceSessionPullRequestLink(sessionId: string, previous: SessionPullRequestLinkV1, next: SessionPullRequestLinkV1, captured?: SessionPullRequestActionScope): Promise<void> {
    const scope = requireCurrentScope(sessionId, captured);
    await getSyncSingleton().patchSessionMetadataWithRetry(sessionId, (metadata) => {
        const withoutPrevious = removeSessionPullRequestLink(metadata, previous);
        return appendSessionPullRequestLink(withoutPrevious, next);
    }, scope);
    if (!scope.shouldContinue()) throw new Error('The session Home account or action changed before changing this pull request link.');
}

export async function captureSessionPullRequestFromSummary(sessionId: string, summary: ScmPullRequestSummary, captured?: SessionPullRequestActionScope): Promise<boolean> {
    const link = sessionPullRequestLinkFromSummary(summary);
    if (!link) return false;
    await addSessionPullRequestLink(sessionId, link, captured);
    return true;
}

/** A fresh call; the open-list cache and local checkout number are never proof for this identity. */
export async function readLinkedPullRequest(sessionId: string, link: SessionPullRequestLinkV1): Promise<ScmPullRequestSummary | null> {
    const scope = captureSessionPullRequestActionScope(sessionId);
    const response = await sessionScmPullRequestGet(sessionId, {
        prReference: { number: link.number },
        linkedIdentity: link,
    }, { serverId: scope.serverId, accountId: scope.accountId });
    if (!scope.shouldContinue()) throw new Error('The session Home account changed while checking this pull request.');
    if (!response.success) throw new Error(response.error);
    if (!response.pullRequest) return null;
    const returned = sessionPullRequestLinkFromSummary(response.pullRequest);
    // Old CLIs may ignore linkedIdentity and look up the same number in the checkout repository.
    if (!returned || sessionPullRequestLinkKey(returned) !== sessionPullRequestLinkKey(link)
        || returned.url !== link.url) throw new Error('The host returned a different pull request identity.');
    return response.pullRequest;
}

export function parseSessionPullRequestUrl(raw: string, configuredProvider?: { kind: 'github' | 'gitlab'; baseUrl: string }): SessionPullRequestLinkV1 | null {
    return sessionPullRequestLinkFromUrl(raw, configuredProvider);
}
