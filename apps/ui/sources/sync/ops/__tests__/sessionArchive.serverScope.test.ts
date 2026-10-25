import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
const metadataPatch = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => ({ patchSessionMetadataWithRetry: metadataPatch }) }));

import { createDeferred, createSessionFixture, renderHook } from '@/dev/testkit';
import { act } from 'react-test-renderer';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { storage, useSessionListViewDataByServerId } from '@/sync/domains/state/storage';
import { upsertServerProfile, setActiveServerId, setServerProfileIdentityForUrl, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { sessionArchiveWithServerScope, sessionUnarchiveWithServerScope } from '../../ops';
import { archiveSessionWithPendingState } from '@/components/sessions/sessionStopArchiveFlow';
import { useVisibleSessionListViewData } from '@/hooks/session/useVisibleSessionListViewData';
import { useResolvedActiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { buildSessionListViewDataForRenderableState } from '@/sync/store/domains/sessionListRenderableCommit';
import { afterSessionArchiveConfirmed } from '../sessions';
import { appendSessionAutoArchiveHistory, readSessionAutoArchiveHistory } from '@happier-dev/protocol';

const sessionId = 'same_session_id';
const response = (archivedAt: number | null) => new Response(JSON.stringify({ success: true, archivedAt }));

function cachedSession(serverId: string) {
    return storage.getState().sessionListViewDataByServerId[serverId]
        ?.find((item) => item.type === 'session' && item.session.id === sessionId);
}

function seedActiveSession(archivedAt: number | null = null) {
    storage.getState().applySessions([createSessionFixture({ id: sessionId, archivedAt, owner: 'account-a' })]);
}

function seedRemoteSession(serverId: string, archivedAt: number | null = null) {
    const item = storage.getState().sessionListViewData?.find((entry) => entry.type === 'session');
    if (!item || item.type !== 'session') throw new Error('Expected a real store session-list projection');
    storage.setState((state) => ({
        sessionListViewDataByServerId: {
            ...state.sessionListViewDataByServerId,
            [serverId]: buildSessionListViewDataForRenderableState({
                ...state,
                sessions: {},
                sessionListRenderables: { [sessionId]: { ...item.session, owner: undefined, archivedAt } },
            }, { serverId }),
        },
    }));
}

describe('server-scoped session archive operations', () => {
    let serverA: ServerProfile;
    let serverB: ServerProfile;
    let activeRequest: MockInstance<typeof apiSocket.request>;
    const activeResponse = vi.fn(async () => response(42));
    const remoteRequest = vi.fn(async () => response(42));

    function requestAtTransportBoundary(path: string, init?: RequestInit): Promise<Response>;
    function requestAtTransportBoundary<T>(path: string, init: RequestInit | undefined, consume: (response: Response) => Promise<T>): Promise<T>;
    async function requestAtTransportBoundary<T>(_path: string, _init?: RequestInit, consume?: (response: Response) => Promise<T>): Promise<Response | T> {
        const result = await activeResponse();
        return consume ? await consume(result) : result;
    }

    beforeEach(() => {
        metadataPatch.mockReset();
        storage.setState(storage.getInitialState(), true);
        serverA = upsertServerProfile({ serverUrl: 'https://archive-a.example' });
        serverB = upsertServerProfile({ serverUrl: 'https://archive-b.example' });
        setActiveServerId(serverA.id);
        activeResponse.mockReset();
        activeResponse.mockImplementation(async () => response(42));
        activeRequest = vi.spyOn(apiSocket, 'request').mockImplementation(requestAtTransportBoundary);
        // Credentials and transport are external boundaries; resolution and all store projections stay real.
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
            token: 'header.eyJzdWIiOiJhY2NvdW50LWEifQ.signature',
        });
        remoteRequest.mockReset();
        remoteRequest.mockImplementation(async () => response(42));
        setRuntimeFetch(remoteRequest);
        seedActiveSession();
    });
    afterEach(() => {
        resetRuntimeFetch();
        vi.restoreAllMocks();
    });

    it('archives the active session through the socket transport and patches its real store projection', async () => {
        await expect(sessionArchiveWithServerScope(sessionId, { serverId: serverA.id }))
            .resolves.toMatchObject({ success: true, archivedAt: 42 });
        expect(activeRequest.mock.calls[0]?.[0]).toBe(`/v2/sessions/${sessionId}/archive`);
        expect(storage.getState().sessions[sessionId]?.archivedAt).toBe(42);
        expect(storage.getState().sessionListRenderables[sessionId]?.archivedAt).toBe(42);
        expect(remoteRequest).not.toHaveBeenCalled();
    });

    it.each(['archive', 'unarchive'] as const)('projects a remote %s into its own cache without touching a same-id active session', async (action) => {
        const before = action === 'archive' ? null : 10;
        const after = action === 'archive' ? 42 : null;
        seedRemoteSession(serverB.id, before);
        remoteRequest.mockImplementation(async () => response(after));
        const activeSession = storage.getState().sessions[sessionId];
        const activeRenderable = storage.getState().sessionListRenderables[sessionId];
        const run = action === 'archive' ? sessionArchiveWithServerScope : sessionUnarchiveWithServerScope;
        await expect(run(sessionId, { serverId: serverB.id })).resolves.toMatchObject({ success: true });
        const remote = cachedSession(serverB.id);
        expect(remote?.type === 'session' ? remote.session.archivedAt : undefined).toBe(after);
        if (!remote || remote.type !== 'session') throw new Error('Expected the remote cached projection');
        expect(storage.getState().sessionListViewDataByServerId[serverB.id]).toEqual(
            buildSessionListViewDataForRenderableState({
                ...storage.getState(), sessions: {}, sessionListRenderables: { [sessionId]: remote.session },
            }, { serverId: serverB.id }),
        );
        expect(storage.getState().sessions[sessionId]).toBe(activeSession);
        expect(storage.getState().sessionListRenderables[sessionId]).toBe(activeRenderable);
        expect(activeRequest).not.toHaveBeenCalled();
        expect(remoteRequest).toHaveBeenCalledWith(expect.stringContaining(`/v2/sessions/${sessionId}/${action}`), expect.any(Object));
    });

    it('settles a request against its original server after the active server changes', async () => {
        const network = createDeferred<Response>();
        activeResponse.mockReturnValueOnce(network.promise);
        const firstSession = storage.getState().sessions[sessionId];
        const result = sessionArchiveWithServerScope(sessionId, { serverId: serverA.id });
        await vi.waitFor(() => expect(activeRequest).toHaveBeenCalledTimes(1));
        setActiveServerId(serverB.id);
        const secondSession = createSessionFixture({ id: sessionId, archivedAt: null, owner: 'account-b' });
        storage.setState({
            sessions: { [sessionId]: secondSession },
            sessionListRenderables: { [sessionId]: buildSessionListRenderableFromSession(secondSession) },
        });
        network.resolve(response(42));
        await expect(result).resolves.toMatchObject({ success: true });
        expect(storage.getState().sessions[sessionId]).toBe(secondSession);
        expect(storage.getState().sessionListRenderables[sessionId]?.archivedAt).toBeNull();
        const first = cachedSession(serverA.id);
        expect(first?.type === 'session' ? first.session.archivedAt : undefined).toBe(42);
        expect(firstSession.archivedAt).toBeNull();
    });

    it('retains a selected remote archive through identity promotion and settles its existing cache', async () => {
        seedRemoteSession(serverB.id);
        storage.getState().applySettingsLocal({
            serverSelectionGroups: [{ id: 'archive-group', name: 'Archive', serverIds: [serverB.id], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'archive-group',
        });
        const network = createDeferred<Response>();
        remoteRequest.mockImplementation(() => network.promise);
        const activeSession = storage.getState().sessions[sessionId];
        const result = archiveSessionWithPendingState(sessionId, () => sessionArchiveWithServerScope(sessionId, { serverId: serverB.id }), serverB.id);
        const hook = await renderHook(() => {
            const selection = useResolvedActiveServerSelection();
            return { visible: useVisibleSessionListViewData(), cache: useSessionListViewDataByServerId(selection.allowedServerIds) };
        });
        try {
            await vi.waitFor(() => expect(remoteRequest).toHaveBeenCalledWith(
                expect.stringContaining(`/v2/sessions/${sessionId}/archive`), expect.anything(),
            ));
            const initial = hook.getCurrent().visible?.filter((item) => item.type === 'session');
            expect(initial).toHaveLength(1);
            expect(initial?.[0]?.session.archiving).toBe(true);
            await act(async () => { setServerProfileIdentityForUrl(serverB.serverUrl, 'srv_remote_archive_promoted'); });
            const promoted = hook.getCurrent().visible?.filter((item) => item.type === 'session');
            await act(async () => { network.resolve(response(42)); await result; });
            const cached = Object.values(hook.getCurrent().cache).flatMap((rows) => rows ?? [])
                .find((item) => item.type === 'session' && item.session.id === sessionId);
            expect({ pendingRows: promoted?.length, archiving: promoted?.[0]?.session.archiving,
                archivedAt: cached?.type === 'session' ? cached.session.archivedAt : undefined })
                .toEqual({ pendingRows: 1, archiving: true, archivedAt: 42 });
            expect(hook.getCurrent().visible?.filter((item) => item.type === 'session')).toEqual([]);
            expect(storage.getState().sessions[sessionId]).toBe(activeSession);
        } finally {
            await act(async () => { network.resolve(response(42)); await result; });
            await hook.unmount();
        }
    });

    it.each(['archive', 'unarchive'] as const)('updates a cache-only active renderable after %s', async (action) => {
        storage.setState({ sessions: {} });
        activeResponse.mockImplementation(async () => response(action === 'archive' ? 42 : null));
        const run = action === 'archive' ? sessionArchiveWithServerScope : sessionUnarchiveWithServerScope;
        await expect(run(sessionId, { serverId: serverA.id })).resolves.toMatchObject({ success: true });
        expect(storage.getState().sessionListRenderables[sessionId]?.archivedAt).toBe(action === 'archive' ? 42 : null);
    });

    it.each(['archive', 'unarchive'] as const)('settles cache-only %s after the captured server identity is promoted', async (action) => {
        const before = action === 'archive' ? null : 10;
        const after = action === 'archive' ? 42 : null;
        seedActiveSession(before);
        storage.setState({ sessions: {} });
        const network = createDeferred<Response>();
        activeResponse.mockReturnValueOnce(network.promise);
        const run = action === 'archive' ? sessionArchiveWithServerScope : sessionUnarchiveWithServerScope;
        const result = run(sessionId, { serverId: serverA.id });
        await vi.waitFor(() => expect(activeRequest).toHaveBeenCalledTimes(1));
        setServerProfileIdentityForUrl(serverA.serverUrl, 'srv_archive_writer_promoted');
        network.resolve(response(after));
        await expect(result).resolves.toMatchObject({ success: true });
        expect(storage.getState().sessionListRenderables[sessionId]?.archivedAt).toBe(after);
    });

    it('preserves local state and returns the stable session_active conflict code', async () => {
        const before = storage.getState().sessions[sessionId];
        activeResponse.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'session-active' }), { status: 409 }));
        await expect(sessionArchiveWithServerScope(sessionId)).resolves.toMatchObject({ success: false, code: 'session_active' });
        expect(storage.getState().sessions[sessionId]).toBe(before);
    });

    it('runs the shared post-success seam for a manual archive without writing an automatic reason', async () => {
        await expect(sessionArchiveWithServerScope(sessionId, { serverId: serverA.id }))
            .resolves.toMatchObject({ success: true, archivedAt: 42 });
        expect(metadataPatch).not.toHaveBeenCalled();
    });

    it('cannot read a same-id active session as proof of a foreign account archive reason', async () => {
        storage.setState({ profileScope: { serverId: serverA.id, accountId: 'account-a' } });
        const result = await afterSessionArchiveConfirmed({
            sessionId, serverId: serverB.id, archivedAt: 42,
            autoArchiveReason: { accountId: 'account-a', links: [{
                providerKind: 'github', providerBaseUrl: 'https://github.com', repository: 'owner/repo',
                number: 7, url: 'https://github.com/owner/repo/pull/7',
            }], shouldContinue: () => true },
        });
        expect(result).toMatchObject({ historyRecorded: false, code: 'archive_reason_not_recorded' });
        expect(metadataPatch).not.toHaveBeenCalled();
    });

    it('does not patch a replacement account session after an admitted automatic archive response', async () => {
        const network = createDeferred<Response>();
        activeResponse.mockReturnValueOnce(network.promise);
        storage.setState({ profileScope: { serverId: serverA.id, accountId: 'account-a' } });
        const reason = {
            accountId: 'account-a',
            links: [{ providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/repo',
                number: 7, url: 'https://github.com/owner/repo/pull/7' }],
            shouldContinue: () => storage.getState().profileScope?.accountId === 'account-a',
            shouldArchive: () => storage.getState().profileScope?.accountId === 'account-a',
        };
        const result = sessionArchiveWithServerScope(sessionId, { serverId: serverA.id, autoArchiveReason: reason });
        await vi.waitFor(() => expect(activeRequest).toHaveBeenCalledTimes(1));
        const replacement = createSessionFixture({ id: sessionId, archivedAt: null, owner: 'account-b' });
        storage.setState({ profileScope: { serverId: serverA.id, accountId: 'account-b' }, sessions: { [sessionId]: replacement },
            sessionListRenderables: { [sessionId]: buildSessionListRenderableFromSession(replacement) } });
        network.resolve(response(42));
        await expect(result).resolves.toMatchObject({ success: true, historyRecorded: false });
        expect(storage.getState().sessions[sessionId]).toBe(replacement);
        expect(storage.getState().sessionListRenderables[sessionId]?.archivedAt).toBeNull();
        expect(metadataPatch).not.toHaveBeenCalled();
    });

    it('keeps the encrypted automatic reason after the canonical unarchive operation', async () => {
        const current = storage.getState().sessions[sessionId]!;
        const link = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/repo',
            number: 7, url: 'https://github.com/owner/repo/pull/7' };
        storage.getState().applySessions([{ ...current, archivedAt: 42,
            metadata: appendSessionAutoArchiveHistory(current.metadata!, {
                trigger: 'all_linked_pull_requests_merged', archivedAt: 42, links: [link],
            }),
        }]);
        activeResponse.mockImplementationOnce(async () => response(null));
        await expect(sessionUnarchiveWithServerScope(sessionId, { serverId: serverA.id }))
            .resolves.toMatchObject({ success: true, archivedAt: null });
        expect(storage.getState().sessions[sessionId]?.archivedAt).toBeNull();
        expect(readSessionAutoArchiveHistory(storage.getState().sessions[sessionId]?.metadata)[0]?.links).toEqual([link]);
    });
});
