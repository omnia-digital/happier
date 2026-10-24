import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSessionPullRequestLinks, sessionPullRequestLinkFromUrl, type ScmPullRequestSummary } from '@happier-dev/protocol';

const patchMock = vi.hoisted(() => vi.fn());
const getMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => ({ patchSessionMetadataWithRetry: patchMock }) }));
vi.mock('@/sync/ops/sessionScm', () => ({ sessionScmPullRequestGet: getMock }));

import { storage } from '@/sync/domains/state/storage';
import { addSessionPullRequestLink, readLinkedPullRequest, replaceSessionPullRequestLink, removeLinkedPullRequest } from './sessionPullRequestLinks';

const originalState = storage.getState();
const link = sessionPullRequestLinkFromUrl('https://github.com/owner/other/pull/51')!;
const wrongRepo: ScmPullRequestSummary = {
    provider: { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com', nameWithOwner: 'owner/current', remoteName: null },
    number: 51, title: 'PR', url: 'https://github.com/owner/current/pull/51', baseBranch: 'main', headBranch: 'topic', state: 'merged',
};

afterEach(() => {
    storage.setState({ profileScope: originalState.profileScope, sessions: originalState.sessions });
    patchMock.mockReset();
    getMock.mockReset();
});

describe('session pull request links', () => {
    it('uses captured account and server scope and preserves unrelated metadata through replace/remove', async () => {
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' }, sessions: {
            s1: { id: 's1', serverId: 'home-a', metadata: { path: '/work', host: 'machine', extra: 'retained' } } as any,
        } });
        patchMock.mockImplementation(async (_id, updater) => {
            const result = updater({ path: '/work', host: 'machine', extra: 'retained' });
            expect(result.extra).toBe('retained');
        });
        await addSessionPullRequestLink('s1', link);
        const options = patchMock.mock.calls[0][2];
        expect(options).toMatchObject({ serverId: 'home-a', accountId: 'account-a' });
        expect(options.shouldContinue()).toBe(true);
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-b' } });
        expect(options.shouldContinue()).toBe(false);
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' } });

        const next = sessionPullRequestLinkFromUrl('https://gitlab.com/group/other/-/merge_requests/51')!;
        patchMock.mockImplementation(async (_id, updater) => {
            const result = updater({ path: '/work', host: 'machine', extra: 'retained', sessionPullRequestsV1: { v: 1, links: [link] } });
            expect(readSessionPullRequestLinks(result)).toEqual([next]);
            expect(result.extra).toBe('retained');
        });
        await replaceSessionPullRequestLink('s1', link, next);
        patchMock.mockImplementation(async (_id, updater) => {
            const result = updater({ path: '/work', host: 'machine', extra: 'retained', sessionPullRequestsV1: { v: 1, links: [next] } });
            expect(readSessionPullRequestLinks(result)).toEqual([]);
            expect(result.extra).toBe('retained');
        });
        await removeLinkedPullRequest('s1', next);
    });

    it('never trusts a same-number response from an older CLI or a missing provider result', async () => {
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' }, sessions: {
            s1: { id: 's1', serverId: 'home-a', metadata: { path: '/work', host: 'machine' } } as any,
        } });
        getMock.mockResolvedValue({ success: true, pullRequest: wrongRepo });
        await expect(readLinkedPullRequest('s1', link)).rejects.toThrow(/different pull request identity/);
        expect(getMock).toHaveBeenCalledWith('s1', { prReference: { number: 51 }, linkedIdentity: link }, { serverId: 'home-a', accountId: 'account-a' });
        getMock.mockResolvedValue({ success: true, pullRequest: null });
        await expect(readLinkedPullRequest('s1', link)).resolves.toBeNull();
    });

    it('drops a held provider result after the Home account changes', async () => {
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' }, sessions: {
            s1: { id: 's1', serverId: 'home-a', metadata: { path: '/work', host: 'machine' } } as any,
        } });
        let release!: (value: unknown) => void;
        getMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const reading = readLinkedPullRequest('s1', link);
        expect(getMock.mock.calls[0][2]).toEqual({ serverId: 'home-a', accountId: 'account-a' });
        storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-b' } });
        release({ success: true, pullRequest: { ...wrongRepo, provider: { ...wrongRepo.provider, nameWithOwner: link.repository }, url: link.url } });
        await expect(reading).rejects.toThrow(/account.*changed/i);
    });
});
