import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, createSessionFixture } from '@/dev/testkit';
import { readSessionAutoArchiveHistory, type ScmPullRequestSummary } from '@happier-dev/protocol';

const providerGet = vi.hoisted(() => vi.fn());
const metadataPatch = vi.hoisted(() => vi.fn());
vi.mock('@/sync/ops/sessionScm', () => ({ sessionScmPullRequestGet: providerGet }));
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => ({ patchSessionMetadataWithRetry: metadataPatch }) }));

import { apiSocket } from '@/sync/api/session/apiSocket';
import { storage } from '@/sync/domains/state/storage';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { createSessionAutoArchiveObserver } from './sessionAutoArchiveObserver';

const links = [
    { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/one', number: 7, url: 'https://github.com/owner/one/pull/7' },
    { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/two', number: 7, url: 'https://github.com/owner/two/pull/7' },
];
const summary = (index: number, state: ScmPullRequestSummary['state'] = 'merged', draft: boolean | undefined = false): ScmPullRequestSummary => ({
    provider: { kind: 'github', name: 'GitHub', baseUrl: links[index]!.providerBaseUrl, nameWithOwner: links[index]!.repository },
    number: links[index]!.number, title: 'Review', url: links[index]!.url, baseBranch: 'main', headBranch: 'topic', state, draft,
});

describe('foreground session autoarchive observer', () => {
    let serverId: string;
    let foreground = true;
    let observer: ReturnType<typeof createSessionAutoArchiveObserver> | null = null;
    const archiveRequest = vi.fn(async () => new Response(JSON.stringify({ archivedAt: 42 })));

    beforeEach(() => {
        storage.setState(storage.getInitialState(), true);
        serverId = upsertServerProfile({ serverUrl: 'https://autoarchive-fixture.example' }).id;
        setActiveServerId(serverId);
        foreground = true;
        providerGet.mockReset();
        archiveRequest.mockReset();
        archiveRequest.mockImplementation(async () => new Response(JSON.stringify({ archivedAt: 42 })));
        vi.spyOn(apiSocket, 'request').mockImplementation(async (_path, _init, consume) => {
            const response = await archiveRequest();
            return consume ? await consume(response) : response;
        });
        metadataPatch.mockReset();
        metadataPatch.mockImplementation(async (id, update, options) => {
            if (!options.shouldContinue()) return;
            const current = storage.getState().sessions[id];
            storage.getState().applySessions([{ ...current, metadata: update(current.metadata), metadataVersion: current.metadataVersion + 1 }]);
        });
        const session = createSessionFixture({
            id: 'session-a', serverId, owner: 'account-a', active: false, archivedAt: null, presence: 1,
            pendingCount: 0, pendingBlockedCount: 0, thinking: false, runtimeActivityState: 'idle', runtimeActivityActiveCount: 0,
            metadata: { path: '/fixture', host: 'fixture-host', agentActivityCounts: { live: 0 }, sessionPullRequestsV1: { v: 1, links } },
        });
        storage.getState().applySessions([session]);
        storage.setState((state) => ({
            profileScope: { serverId, accountId: 'account-a' }, settingsScope: { serverId, accountId: 'account-a' },
            settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: false },
        }));
    });
    afterEach(() => {
        observer?.dispose();
        observer = null;
        vi.restoreAllMocks();
    });

    function start(checkIntervalMs = 60_000, maxConcurrentCandidates = 4) {
        observer = createSessionAutoArchiveObserver({
            isForeground: () => foreground, ensureMetadata: async () => true,
            checkIntervalMs, maxConcurrentCandidates,
        });
    }
    function enable() {
        storage.setState((state) => ({ settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: true } }));
    }

    it('does no provider or archive work while disabled or backgrounded, then archives an inactive all-merged session once', async () => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(input.linkedIdentity.repository === 'owner/one' ? 0 : 1) }));
        start();
        expect(providerGet).not.toHaveBeenCalled();
        foreground = false;
        enable();
        expect(providerGet).not.toHaveBeenCalled();
        foreground = true;
        observer!.recheck();
        await vi.waitFor(() => expect(archiveRequest).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(readSessionAutoArchiveHistory(storage.getState().sessions['session-a']?.metadata)).toHaveLength(1));
        expect(providerGet).toHaveBeenCalledTimes(2);
        expect(readSessionAutoArchiveHistory(storage.getState().sessions['session-a']?.metadata)[0]?.links).toEqual(links);
        observer!.recheck();
        expect(archiveRequest).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['open', summary(1, 'open')], ['draft', summary(1, 'merged', true)], ['unknown draft', { ...summary(1), draft: undefined }],
        ['closed', summary(1, 'closed')], ['unavailable', null],
    ])('does not archive with a %s second repository result', async (_label, second) => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: input.linkedIdentity.repository === 'owner/one' ? summary(0) : second }));
        start(); enable();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(2));
        expect(archiveRequest).not.toHaveBeenCalled();
    });

    it('drops a held merged result after Home account changes or the link set changes', async () => {
        const held = createDeferred<{ success: true; pullRequest: ScmPullRequestSummary }>();
        providerGet.mockReturnValueOnce(held.promise);
        start(); enable();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
        storage.setState({ profileScope: { serverId, accountId: 'account-b' }, settingsScope: { serverId, accountId: 'account-b' } });
        held.resolve({ success: true, pullRequest: summary(0) });
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
        expect(archiveRequest).not.toHaveBeenCalled();
    });

    it('rechecks linked identities before archive admission when an unmerged link is added during a provider read', async () => {
        const held = createDeferred<{ success: true; pullRequest: ScmPullRequestSummary }>();
        providerGet.mockReturnValueOnce(held.promise);
        start(); enable();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
        const current = storage.getState().sessions['session-a']!;
        storage.getState().applySessions([{ ...current, metadata: {
            ...current.metadata!, sessionPullRequestsV1: { v: 1, links: [
                ...links, { providerKind: 'gitlab', providerBaseUrl: 'https://gitlab.com', repository: 'group/other', number: 9,
                    url: 'https://gitlab.com/group/other/-/merge_requests/9' },
            ] },
        } }]);
        held.resolve({ success: true, pullRequest: summary(0) });
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
        expect(archiveRequest).not.toHaveBeenCalled();
    });

    it('observes an inactive transition through the real catalog projection', async () => {
        const current = storage.getState().sessions['session-a']!;
        storage.getState().applySessions([{ ...current, active: true }]);
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(input.linkedIdentity.repository === 'owner/one' ? 0 : 1) }));
        start(); enable();
        expect(providerGet).not.toHaveBeenCalled();
        storage.getState().applySessions([{ ...storage.getState().sessions['session-a']!, active: false }]);
        await vi.waitFor(() => expect(archiveRequest).toHaveBeenCalledTimes(1));
    });

    it('notices a remote merge on the foreground cadence without a catalog update', async () => {
        let merged = false;
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(
            input.linkedIdentity.repository === 'owner/one' ? 0 : 1,
            input.linkedIdentity.repository === 'owner/two' && !merged ? 'open' : 'merged',
        ) }));
        start(200); enable();
        await vi.waitFor(() => expect(providerGet.mock.calls.length).toBeGreaterThanOrEqual(2));
        expect(archiveRequest).not.toHaveBeenCalled();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(providerGet).toHaveBeenCalledTimes(2);
        merged = true;
        await vi.waitFor(() => expect(archiveRequest).toHaveBeenCalledTimes(1));
    });

    it('suspends recurring provider reads while hidden and resumes through the same observer', async () => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(
            input.linkedIdentity.repository === 'owner/one' ? 0 : 1, 'open',
        ) }));
        start(150); enable();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(2));
        foreground = false;
        await new Promise((resolve) => setTimeout(resolve, 220));
        expect(providerGet).toHaveBeenCalledTimes(2);
        foreground = true;
        observer!.recheck();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(4));
        expect(archiveRequest).not.toHaveBeenCalled();
    });

    it('retires queued candidate work when disabled while another provider read is held', async () => {
        const first = storage.getState().sessions['session-a']!;
        storage.getState().applySessions([{ ...first, id: 'session-b' }]);
        const held = createDeferred<{ success: true; pullRequest: ScmPullRequestSummary }>();
        providerGet.mockReturnValueOnce(held.promise);
        start(60_000, 1); enable();
        await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
        observer!.recheck();
        storage.setState((state) => ({ settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: false } }));
        held.resolve({ success: true, pullRequest: summary(0) });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(providerGet).toHaveBeenCalledTimes(1);
        expect(archiveRequest).not.toHaveBeenCalled();
    });

    it('retains a failed post-success history write for foreground retry without crossing Home accounts', async () => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(input.linkedIdentity.repository === 'owner/one' ? 0 : 1) }));
        metadataPatch.mockRejectedValueOnce(new Error('offline metadata write'));
        start(); enable();
        await vi.waitFor(() => expect(metadataPatch).toHaveBeenCalledTimes(1));
        expect(storage.getState().sessions['session-a']?.archivedAt).toBe(42);
        expect(readSessionAutoArchiveHistory(storage.getState().sessions['session-a']?.metadata)).toHaveLength(0);
        storage.setState({ profileScope: { serverId, accountId: 'account-b' }, settingsScope: { serverId, accountId: 'account-b' } });
        observer!.recheck();
        expect(metadataPatch).toHaveBeenCalledTimes(1);
        storage.setState({ profileScope: { serverId, accountId: 'account-a' }, settingsScope: { serverId, accountId: 'account-a' } });
        observer!.recheck();
        await vi.waitFor(() => expect(readSessionAutoArchiveHistory(storage.getState().sessions['session-a']?.metadata)).toHaveLength(1));
        expect(archiveRequest).toHaveBeenCalledTimes(1);
    });

    it('records the admitted archive reason after the preference is disabled during a held server response', async () => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(input.linkedIdentity.repository === 'owner/one' ? 0 : 1) }));
        const held = createDeferred<Response>();
        archiveRequest.mockReturnValue(held.promise);
        start(); enable();
        await vi.waitFor(() => expect(archiveRequest).toHaveBeenCalledTimes(1));
        storage.setState((state) => ({ settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: false } }));
        held.resolve(new Response(JSON.stringify({ archivedAt: 42 })));
        await vi.waitFor(() => expect(readSessionAutoArchiveHistory(storage.getState().sessions['session-a']?.metadata)).toHaveLength(1));
        expect(archiveRequest).toHaveBeenCalledTimes(1);
    });

    it('never records a reason when the server rejects the archive race', async () => {
        providerGet.mockImplementation(async (_id, input) => ({ success: true, pullRequest: summary(input.linkedIdentity.repository === 'owner/one' ? 0 : 1) }));
        archiveRequest.mockImplementation(async () => new Response('active', { status: 409 }));
        start(); enable();
        await vi.waitFor(() => expect(archiveRequest).toHaveBeenCalledTimes(1));
        expect(metadataPatch).not.toHaveBeenCalled();
        expect(storage.getState().sessions['session-a']?.archivedAt).toBeNull();
    });
});
