import { matchServerFetchUrl } from '@/dev/testkit/mocks/serverFetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appStateAddListener = vi.hoisted(() => vi.fn(() => ({ remove: vi.fn() })));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                                            Platform: {
                                                OS: 'web',
                                            },
                                            AppState: {
                                                addEventListener: appStateAddListener as any,
                                            },
                                        }
    );
});

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: {
        onAgentRequest: vi.fn(),
        onSessionFocus: vi.fn(),
        onSessionOffline: vi.fn(),
        onSessionOnline: vi.fn(),
        onMessages: vi.fn(),
        onReady: vi.fn(),
        reportContextualUpdate: vi.fn(),
    },
}));

vi.mock('@/track', () => ({
    initializeTracking: vi.fn(),
    tracking: null,
    trackPaywallPresented: vi.fn(),
    trackPaywallPurchased: vi.fn(),
    trackPaywallCancelled: vi.fn(),
    trackPaywallRestored: vi.fn(),
    trackPaywallError: vi.fn(),
}));

const requestMock = vi.hoisted(() => vi.fn());
const providerGet = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());
const createEncryptionFromAuthCredentialsMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        request: requestMock,
        emitWithAck: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        onStatusChange: vi.fn(),
        onReconnected: vi.fn(),
        disconnect: vi.fn(),
        initialize: vi.fn(),
    },
}));
vi.mock('@/sync/ops/sessionScm', () => ({ sessionScmPullRequestGet: providerGet }));

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: runtimeFetchMock,
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return { ...actual, TokenStorage: { ...actual.TokenStorage, getCredentialsForServerUrl: getCredentialsForServerUrlMock } };
});

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: createEncryptionFromAuthCredentialsMock,
}));

import { storage } from './domains/state/storage';
import { setActiveServerId, upsertServerProfile } from './domains/server/serverProfiles';
import { loadSessionMaterializedMaxSeqById } from './domains/state/persistence';
import type { AccountSettingsScope } from './domains/settings/scope/accountSettingsScope';
import type { Session } from './domains/state/storageTypes';
import { encodeBase64 } from '@/encryption/base64';
import { encodeUTF8 } from '@/encryption/text';
import { clearTempData, peekTempData, type NewSessionData } from '@/utils/sessions/tempDataStore';

const initialStorageState = storage.getState();

function createSession(params: { sessionId: string }): Session {
    const now = Date.now();
    return {
        id: params.sessionId,
        seq: 0,
        encryptionMode: 'e2ee',
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        optimisticThinkingAt: null,
    };
}

function buildTokenWithSub(sub: string): string {
    const payload = encodeBase64(encodeUTF8(JSON.stringify({ sub })), 'base64');
    return `hdr.${payload}.sig`;
}

describe('sync.ensureSessionVisibleForMessageRoute', () => {
    beforeEach(async () => {
        storage.setState(initialStorageState, true);
        appStateAddListener.mockClear();
        requestMock.mockReset();
        providerGet.mockReset();
        runtimeFetchMock.mockReset();
        getCredentialsForServerUrlMock.mockReset();
        createEncryptionFromAuthCredentialsMock.mockReset();
        clearTempData();

        const { sync } = await import('./sync');
        sync.disconnectServer();
    });

    it('hydrates all loaded metadata candidates through the real scoped loader with its configured concurrency', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://status-fixture.example', name: 'Status fixture' });
        setActiveServerId(activeServer.id);
        const { sync } = await import('./sync');
        const { Encryption } = await import('./encryption/encryption');
        const owner = sync as unknown as { credentials: unknown; encryption: unknown; syncTuning: { sessionListHydrationConcurrencyLimit: number };
            ensureSessionListMetadata: (candidates: readonly { sessionId: string; serverId?: string }[], shouldContinue: () => boolean) => Promise<unknown[]> };
        owner.credentials = { token: 'active-token', secret: 'isolated-secret' };
        owner.encryption = await Encryption.create(new Uint8Array(32).fill(3));
        let active = 0; let peak = 0;
        requestMock.mockImplementation(async (path: string) => {
            active++; peak = Math.max(peak, active);
            await Promise.resolve(); active--;
            const id = path.split('/').pop()!;
            return new Response(JSON.stringify({ session: { id, seq: 0, createdAt: 1, updatedAt: 2, active: false, activeAt: 2,
                encryptionMode: 'plain', dataEncryptionKey: null, metadata: JSON.stringify({ path: '/repo', host: 'fixture', name: id }), metadataVersion: 1,
                agentState: null, agentStateVersion: 0, share: null } }), { status: 200 });
        });
        const candidates = Array.from({ length: 40 }, (_, index) => ({ sessionId: `status-candidate-${index}` }));
        await Promise.all([owner.ensureSessionListMetadata(candidates, () => true), owner.ensureSessionListMetadata(candidates, () => true)]);
        for (const candidate of candidates) expect(storage.getState().sessions[candidate.sessionId]?.metadata?.name).toBe(candidate.sessionId);
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(candidates.map(candidate => `/v2/sessions/${candidate.sessionId}`));
        expect(peak).toBeLessThanOrEqual(owner.syncTuning.sessionListHydrationConcurrencyLimit);
    });

    it.each(['warm', 'cold', 'hydrated'] as const)('lets a %s encrypted catalog row reach the observer through the real metadata-only Sync loader', async (cacheKind) => {
        const { createSessionFixture } = await import('@/dev/testkit');
        const { Encryption } = await import('./encryption/encryption');
        const { fetchAndApplySessions } = await import('./engine/sessions/sessionSnapshot');
        const { buildSessionListRenderableFromSession } = await import('./domains/session/listing/sessionListRenderable');
        const { buildSessionListCacheEntryFromRenderable } = await import('./domains/state/warmCacheAdapters');
        const { createSessionAutoArchiveObserver } = await import('./engine/sessions/sessionAutoArchiveObserver');
        const activeServer = upsertServerProfile({ serverUrl: `https://autoarchive-${cacheKind}.example.test` });
        setActiveServerId(activeServer.id);
        const id = `autoarchive-${cacheKind}`;
        const link = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/repo',
            number: 7, url: 'https://github.com/owner/repo/pull/7' };
        const metadata = { path: '/fixture', host: 'fixture', agentActivityCounts: { live: 0 },
            sessionPullRequestsV1: { v: 1 as const, links: [link] } };
        const encryption = await Encryption.create(new Uint8Array(32).fill(7));
        const dataKey = new Uint8Array(32).fill(8);
        await encryption.initializeSessions(new Map([[id, dataKey]]), { serverId: activeServer.id });
        const sessionEncryption = encryption.getSessionEncryption(id)!;
        const row = {
            id, seq: 0, createdAt: 1, updatedAt: 2, meaningfulActivityAt: 2, active: false, activeAt: 2, archivedAt: null,
            encryptionMode: 'e2ee' as const, metadata: await sessionEncryption.encryptMetadata(metadata), metadataVersion: 1,
            agentState: await sessionEncryption.encryptAgentState({}), agentStateVersion: 1,
            dataEncryptionKey: encodeBase64(await encryption.encryptEncryptionKey(dataKey), 'base64'), share: null,
            pendingCount: 0, pendingBlockedCount: 0, pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0,
            latestTurnStatus: 'completed' as const, runtimeActivityState: 'idle' as const, runtimeActivityActiveCount: 0,
            runtimeActivityObservedAt: 2, runtimeActivityRevision: 1, thinking: false,
        };
        const { V2SessionRecordSchema } = await import('@happier-dev/protocol');
        expect(V2SessionRecordSchema.safeParse(row).success).toBe(true);
        const { sync } = await import('./sync');
        const owner = sync as unknown as { credentials: unknown; encryption: Awaited<ReturnType<typeof Encryption.create>>; sessionDataKeys: Map<string, Uint8Array>;
            ensureSessionListMetadata: (candidates: readonly { sessionId: string; serverId: string; forceRefresh: boolean }[], current: () => boolean) => Promise<Array<{ kind: string } | null>> };
        owner.credentials = { token: buildTokenWithSub('account-a'), secret: 'fixture-secret' };
        owner.encryption = encryption;
        owner.sessionDataKeys = new Map();
        storage.setState((state) => ({ profileScope: { serverId: activeServer.id, accountId: 'account-a' },
            settingsScope: { serverId: activeServer.id, accountId: 'account-a' },
            settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: false } }));
        const cached = cacheKind === 'warm' ? buildSessionListCacheEntryFromRenderable(buildSessionListRenderableFromSession(
            createSessionFixture({ id, owner: 'account-a', active: false, metadataVersion: 1, metadata }),
        )) : undefined;
        await fetchAndApplySessions({ serverId: activeServer.id, credentials: owner.credentials as any, encryption,
            sessionDataKeys: owner.sessionDataKeys, cachedSessionListEntries: cached ? { [id]: cached } : {},
            sessionListEagerHydrationCount: cacheKind === 'hydrated' ? 1 : 0, sessionListBackgroundHydrationMaxRows: 0,
            requiredHydrationSessionIds: cacheKind === 'hydrated' ? [id] : [],
            awaitSessionListHydration: cacheKind === 'hydrated',
            request: async () => new Response(JSON.stringify({ sessions: [row], hasNext: false, nextCursor: null }), { status: 200 }),
            getExistingSession: (sessionId) => storage.getState().sessions[sessionId] ?? null,
            getCurrentSessionListRenderable: (sessionId) => storage.getState().sessionListRenderables[sessionId] ?? null,
            applySessionListRenderables: (rows) => storage.getState().mergeSessionListRenderables(rows),
            applySessionListRenderablePatches: (patches) => storage.getState().applySessionListRenderablePatches(patches),
            applySessions: (sessions) => storage.getState().applySessions(sessions),
            repairInvalidReadStateV1: async () => {}, log: { log: () => {} },
        });
        const { createSessionActionTarget } = await import('@/components/sessions/actions/sessionActionContext');
        const { listVisibleSessionActionIds } = await import('@/components/sessions/actions/sessionActionAvailability');
        const snapshotTarget = createSessionActionTarget({ session: storage.getState().sessionListRenderables[id]! });
        expect(snapshotTarget.isOwnedByCurrentUser).toBe(true);
        expect(listVisibleSessionActionIds({ target: snapshotTarget, surface: 'sessionInfo' })).toContain('ui.session.delete');
        expect(storage.getState().sessionListRenderables[id]?.accessLevel).toBeUndefined();
        if (cacheKind !== 'hydrated') {
            expect(storage.getState().sessions[id]).toBeUndefined();
            expect(storage.getState().sessionListRenderables[id]?.metadata?.agentActivityCounts).toBeUndefined();
        } else {
            expect(storage.getState().sessions[id]?.metadata?.sessionPullRequestsV1?.links).toEqual([link]);
            expect(storage.getState().sessions[id]?.authenticatedOwnerAccountId).toBeUndefined();
        }
        expect(storage.getState().sessionListRenderables[id]?.metadata?.sessionPullRequestsV1?.links).toEqual(cacheKind !== 'cold' ? [link] : undefined);
        const { assessSessionAutoArchiveHydrationCandidate } = await import('./domains/session/archive/sessionAutoArchiveEligibility');
        expect(assessSessionAutoArchiveHydrationCandidate({ session: storage.getState().sessionListRenderables[id]!, enabled: true,
            archivePending: false, accountId: 'account-a' })).toEqual({ eligible: true, reason: 'ready' });
        requestMock.mockImplementation(async (path: string) => {
            if (path === `/v2/sessions/${id}`) return new Response(JSON.stringify({ session: row }), { status: 200 });
            throw new Error(`Unexpected fixture request: ${path}`);
        });
        providerGet.mockResolvedValue({ success: true, pullRequest: null });
        const observer = createSessionAutoArchiveObserver({ isForeground: () => true,
            ensureMetadata: async (sessionId, serverId, shouldContinue, forceRefresh) =>
                (await owner.ensureSessionListMetadata([{ sessionId, serverId, forceRefresh }], shouldContinue))[0]?.kind === 'available',
            checkIntervalMs: 300_000, maxConcurrentCandidates: 4 });
        try {
            expect(requestMock).not.toHaveBeenCalled();
            storage.setState((state) => ({ settings: { ...state.settings, autoArchiveAfterLinkedPullRequestsMerge: true } }));
            await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
            await vi.waitFor(() => expect(storage.getState().sessions[id]).toBeDefined());
            await vi.waitFor(() => expect(providerGet).toHaveBeenCalledTimes(1));
            expect(requestMock.mock.calls.map(([path]) => path)).toEqual([`/v2/sessions/${id}`]);
            const { readSessionPullRequestLinks } = await import('@happier-dev/protocol');
            expect(readSessionPullRequestLinks(storage.getState().sessions[id]?.metadata)).toEqual([link]);
            const hydratedTarget = createSessionActionTarget({ session: storage.getState().sessions[id]! });
            expect(hydratedTarget.isOwnedByCurrentUser).toBe(true);
            expect(listVisibleSessionActionIds({ target: hydratedTarget, surface: 'sessionInfo' })).toContain('ui.session.delete');
            expect(storage.getState().sessions[id]?.accessLevel).toBeUndefined();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(providerGet).toHaveBeenCalledTimes(1);
        } finally {
            observer.dispose();
        }
    });

    it('drops queued metadata demand on release and refuses held publication after a scope retires', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://status-retirement.example', name: 'Status retirement fixture' });
        setActiveServerId(activeServer.id);
        const { sync } = await import('./sync');
        const { Encryption } = await import('./encryption/encryption');
        const owner = sync as unknown as { credentials: unknown; encryption: unknown; syncTuning: { sessionListHydrationConcurrencyLimit: number };
            ensureSessionListMetadata: (candidates: readonly { sessionId: string }[], shouldContinue: () => boolean) => Promise<unknown[]> };
        owner.credentials = { token: 'active-token', secret: 'isolated-secret' };
        owner.encryption = await Encryption.create(new Uint8Array(32).fill(4));
        const releaseRequests: Array<() => void> = [];
        requestMock.mockImplementation(async (path: string) => {
            await new Promise<void>(resolve => releaseRequests.push(resolve));
            const id = path.split('/').pop()!;
            return new Response(JSON.stringify({ session: { id, seq: 0, createdAt: 1, updatedAt: 2, active: false, activeAt: 2,
                encryptionMode: 'plain', dataEncryptionKey: null, metadata: JSON.stringify({ path: '/retired', host: 'fixture', name: id }), metadataVersion: 1,
                agentState: null, agentStateVersion: 0, share: null } }), { status: 200 });
        });
        let current = true;
        const candidates = Array.from({ length: 40 }, (_, index) => ({ sessionId: `retired-status-${index}` }));
        const pending = owner.ensureSessionListMetadata(candidates, () => current);
        await vi.waitFor(() => expect(releaseRequests).toHaveLength(owner.syncTuning.sessionListHydrationConcurrencyLimit));
        current = false; sync.disconnectServer(); releaseRequests.forEach(release => release());
        await pending;
        expect(requestMock).toHaveBeenCalledTimes(owner.syncTuning.sessionListHydrationConcurrencyLimit);
        for (const candidate of candidates) expect(storage.getState().sessions[candidate.sessionId]).toBeUndefined();
    });

    it('refreshes route messages when a route joins held metadata-only shell hydration', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://status-route-join.example', name: 'Status route fixture' });
        setActiveServerId(activeServer.id);
        const { sync } = await import('./sync');
        const { Encryption } = await import('./encryption/encryption');
        const owner = sync as unknown as { credentials: unknown; encryption: unknown;
            ensureSessionListMetadata: (candidates: readonly { sessionId: string }[], shouldContinue: () => boolean) => Promise<unknown[]> };
        owner.credentials = { token: 'route-token', secret: 'isolated-secret' };
        owner.encryption = await Encryption.create(new Uint8Array(32).fill(5));
        let release = () => {};
        const held = new Promise<void>(resolve => { release = resolve; });
        const id = 'metadata-first-route-join';
        requestMock.mockImplementation(async (path: string) => {
            if (path === `/v2/sessions/${id}`) {
                await held;
                return new Response(JSON.stringify({ session: { id, seq: 0, createdAt: 1, updatedAt: 2, active: false, activeAt: 2,
                    encryptionMode: 'plain', dataEncryptionKey: null, metadata: JSON.stringify({ path: '/repo', host: 'fixture' }), metadataVersion: 1,
                    agentState: null, agentStateVersion: 0, share: null } }), { status: 200 });
            }
            if (path.startsWith(`/v1/sessions/${id}/messages?`)) return new Response(JSON.stringify({ messages: [] }), { status: 200 });
            throw new Error(`Unexpected fixture request: ${path}`);
        });
        const metadata = owner.ensureSessionListMetadata([{ sessionId: id }], () => true);
        await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
        const route = sync.ensureSessionVisibleForMessageRoute(id);
        release(); await Promise.all([metadata, route]);
        await vi.waitFor(() => expect(requestMock.mock.calls.some(([path]) => path.startsWith(`/v1/sessions/${id}/messages?`))).toBe(true));
        expect(requestMock.mock.calls.filter(([path]) => path === `/v2/sessions/${id}`)).toHaveLength(1);
    });

    it('projects completed but unreadable metadata as unavailable through the mounted status-demand hook', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://status-unreadable.example', name: 'Status unreadable fixture' });
        setActiveServerId(activeServer.id);
        const { sync } = await import('./sync');
        const { Encryption } = await import('./encryption/encryption');
        const { renderHook, flushHookEffects, createSessionFixture } = await import('@/dev/testkit');
        const { buildSessionListRenderableFromSession } = await import('./domains/session/listing/sessionListRenderable');
        const { useSessionListStatusInputs } = await import('@/components/sessions/shell/view-state/useSessionListStatusInputs');
        const owner = sync as unknown as { credentials: unknown; encryption: unknown };
        owner.credentials = { token: 'unreadable-token', secret: 'isolated-secret' };
        owner.encryption = await Encryption.create(new Uint8Array(32).fill(6));
        const id = 'unreadable-status-metadata';
        const pending = buildSessionListRenderableFromSession(createSessionFixture({ id, metadata: null }));
        storage.getState().mergeSessionListRenderables([pending]);
        const confirmed = buildSessionListRenderableFromSession(createSessionFixture({ id: 'confirmed-metadata', metadata: { path: '/repo', host: 'fixture' } }));
        const items = [{ type: 'session' as const, serverId: activeServer.id, session: pending }, { type: 'session' as const, serverId: activeServer.id, session: confirmed }];
        requestMock.mockResolvedValue(new Response(JSON.stringify({ session: { id, seq: 0, createdAt: 1, updatedAt: 2, active: false, activeAt: 2,
            encryptionMode: 'plain', dataEncryptionKey: null, metadata: 'null', metadataVersion: 1, agentState: null, agentStateVersion: 0, share: null } }), { status: 200 }));
        const hook = await renderHook((rows: typeof items) => useSessionListStatusInputs(rows, activeServer.id, true, false, true), { initialProps: items });
        try {
            await flushHookEffects({ cycles: 15 });
            expect(requestMock).toHaveBeenCalledTimes(1);
            expect(hook.getCurrent().metadataStates.get(`${activeServer.id}:${id}`)?.phase).toBe('unavailable');
            expect(hook.getCurrent().ticketAssociations.get(`${activeServer.id}:${id}`)).toBeUndefined();
            await hook.rerender([...items].reverse());
            expect(hook.getCurrent().metadataStates.get(`${activeServer.id}:${id}`)?.phase).toBe('unavailable');
            expect(requestMock).toHaveBeenCalledTimes(1);
        } finally { await hook.unmount(); }
    });

    it('hydrates e2ee session encryption on deep link before sessions snapshot fetch', async () => {
        const sessionId = 'deep_link_session';
        storage.getState().applySessions([createSession({ sessionId })]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');
        const syncInternals = sync as unknown as {
            credentials: { token: string } | null;
            activeServerSessionIds: Set<string>;
            hasFetchedSessionsSnapshotForActiveServer: boolean;
            encryption: unknown;
            sessionDataKeys: Map<string, Uint8Array>;
            sessionDataKeyEnvelopes: Map<string, string>;
        };

        syncInternals.credentials = { token: 't' };
        syncInternals.activeServerSessionIds = new Set<string>();
        syncInternals.hasFetchedSessionsSnapshotForActiveServer = false;

        let ready = false;
        const decryptMetadata = vi.fn(async () => ({ readStateV1: null }));
        const decryptAgentState = vi.fn(async () => ({ controlledByUser: true }));

        syncInternals.encryption = {
            decryptEncryptionKey: async () => new Uint8Array([1, 2, 3]),
            initializeSessions: async () => {
                ready = true;
            },
            getSessionEncryption: (_sessionId: string) =>
                ready ? ({ decryptMetadata, decryptAgentState } as any) : null,
        };

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'dek',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        const sessionByIdCalls = requestMock.mock.calls.filter(
            (call) => call?.[0] === `/v2/sessions/${sessionId}`,
        );
        expect(sessionByIdCalls).toHaveLength(1);
        expect(syncInternals.activeServerSessionIds.has(sessionId)).toBe(true);
        expect(syncInternals.sessionDataKeys.get(sessionId)).toEqual(new Uint8Array([1, 2, 3]));
        expect(syncInternals.sessionDataKeyEnvelopes.get(sessionId)).toBe('dek');
    });

    it('returns a retryable result when credentials are not yet available', async () => {
        const sessionId = 'deep_link_missing_creds';
        storage.getState().applySessions([createSession({ sessionId })]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');
        (sync as any).credentials = null;
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            getSessionEncryption: () => null,
        };

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'retryable_failure',
            sessionId,
            cause: 'unknown',
        }));
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('classifies session-by-id network failures as server unavailable retry results', async () => {
        const sessionId = 'deep_link_server_unavailable';
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };

        const connectivityError = new Error('Timed out waiting for server reachability');
        connectivityError.name = 'ServerFetchConnectivityTimeoutError';
        requestMock.mockRejectedValue(connectivityError);

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'retryable_failure',
            sessionId,
            cause: 'server_unavailable',
        }));
    });

    it('treats not-found session ids as terminal when the route carries explicit server scope', async () => {
        const sessionId = 'deep_link_missing_session';
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };

        requestMock.mockResolvedValue(new Response('not found', { status: 404 }));

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { serverId: activeServer.id })).resolves.toEqual({
            kind: 'missing',
            sessionId,
            serverId: activeServer.id,
            cause: 'not_found',
        });
    });

    it('treats not-found session ids as terminal so deep links can fail closed instead of spinning forever', async () => {
        const sessionId = 'deep_link_missing_session_active_fallback';

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };

        requestMock.mockResolvedValue(new Response('not found', { status: 404 }));

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual({
            kind: 'missing',
            sessionId,
            cause: 'not_found',
        });
    });

    it('does not apply an old in-flight route hydration after the server scope resets', async () => {
        const sessionId = 'deep_link_stale_reset';
        const currentScopeKey = new Uint8Array([4, 5, 6]);
        let resolveSessionResponse!: (response: Response) => void;
        const sessionResponse = new Promise<Response>((resolve) => {
            resolveSessionResponse = resolve;
        });

        const { sync } = await import('./sync');
        const syncInternals = sync as unknown as {
            credentials: { token: string } | null;
            activeServerSessionIds: Set<string>;
            hasFetchedSessionsSnapshotForActiveServer: boolean;
            encryption: unknown;
            sessionDataKeys: Map<string, Uint8Array>;
            sessionDataKeyEnvelopes: Map<string, string>;
        };

        syncInternals.credentials = { token: 't' };
        syncInternals.activeServerSessionIds = new Set<string>();
        syncInternals.hasFetchedSessionsSnapshotForActiveServer = false;
        syncInternals.encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };

        requestMock.mockImplementation(async (path: string) => {
            if (path === `/v2/sessions/${sessionId}`) {
                return await sessionResponse;
            }
            if (path === `/v1/sessions/${sessionId}/turns`) {
                return new Response('not found', { status: 404 });
            }
            throw new Error(`unexpected request ${path}`);
        });

        const hydrationPromise = sync.ensureSessionVisibleForMessageRoute(sessionId);
        await vi.waitFor(() => {
            expect(requestMock).toHaveBeenCalledWith(
                `/v2/sessions/${sessionId}`,
                expect.objectContaining({ method: 'GET' }),
            );
        });

        sync.disconnectServer();
        syncInternals.sessionDataKeys.set(sessionId, currentScopeKey);
        syncInternals.sessionDataKeyEnvelopes.set(sessionId, 'current-scope-envelope');

        resolveSessionResponse(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'plain',
                        dataEncryptionKey: null,
                        metadataVersion: 0,
                        metadata: 'null',
                        agentStateVersion: 0,
                        agentState: null,
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(hydrationPromise).resolves.toEqual(expect.objectContaining({
            kind: 'retryable_failure',
            sessionId,
        }));
        expect(storage.getState().sessions[sessionId]).toBeUndefined();
        expect(syncInternals.activeServerSessionIds.has(sessionId)).toBe(false);
        expect(syncInternals.sessionDataKeys.get(sessionId)).toBe(currentScopeKey);
        expect(syncInternals.sessionDataKeyEnvelopes.get(sessionId)).toBe('current-scope-envelope');
    });

    it('does not let stale encrypted route hydration overwrite current key caches after the server scope resets', async () => {
        const sessionId = 'deep_link_stale_encrypted_key_cache';
        const staleFetchedKey = new Uint8Array([1, 2, 3]);
        const currentScopeKey = new Uint8Array([7, 8, 9]);
        let resolveSessionResponse!: (response: Response) => void;
        const sessionResponse = new Promise<Response>((resolve) => {
            resolveSessionResponse = resolve;
        });

        const { sync } = await import('./sync');
        const syncInternals = sync as unknown as {
            credentials: { token: string } | null;
            activeServerSessionIds: Set<string>;
            hasFetchedSessionsSnapshotForActiveServer: boolean;
            encryption: unknown;
            sessionDataKeys: Map<string, Uint8Array>;
            sessionDataKeyEnvelopes: Map<string, string>;
        };

        syncInternals.credentials = { token: 't' };
        syncInternals.activeServerSessionIds = new Set<string>();
        syncInternals.hasFetchedSessionsSnapshotForActiveServer = false;
        syncInternals.encryption = {
            decryptEncryptionKey: async () => staleFetchedKey,
            initializeSessions: async () => {},
            getSessionEncryption: () => ({
                decryptMetadata: async () => ({ readStateV1: null }),
                decryptAgentState: async () => ({ controlledByUser: true }),
            }),
        };

        requestMock.mockImplementation(async (path: string) => {
            if (path === `/v2/sessions/${sessionId}`) {
                return await sessionResponse;
            }
            if (path === `/v1/sessions/${sessionId}/turns`) {
                return new Response('not found', { status: 404 });
            }
            throw new Error(`unexpected request ${path}`);
        });

        const hydrationPromise = sync.ensureSessionVisibleForMessageRoute(sessionId);
        await vi.waitFor(() => {
            expect(requestMock).toHaveBeenCalledWith(
                `/v2/sessions/${sessionId}`,
                expect.objectContaining({ method: 'GET' }),
            );
        });

        sync.disconnectServer();
        syncInternals.sessionDataKeys.set(sessionId, currentScopeKey);
        syncInternals.sessionDataKeyEnvelopes.set(sessionId, 'current-scope-envelope');

        resolveSessionResponse(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'stale-server-envelope',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(hydrationPromise).resolves.toEqual(expect.objectContaining({
            kind: 'retryable_failure',
            sessionId,
        }));
        expect(storage.getState().sessions[sessionId]).toBeUndefined();
        expect(syncInternals.activeServerSessionIds.has(sessionId)).toBe(false);
        expect(syncInternals.sessionDataKeys.get(sessionId)).toBe(currentScopeKey);
        expect(syncInternals.sessionDataKeyEnvelopes.get(sessionId)).toBe('current-scope-envelope');
    });

    it('persists session materialization progress in the active account/server scope', async () => {
        const scope: AccountSettingsScope = { serverId: 'server-a', accountId: 'account-a' };
        const { sync } = await import('./sync');
        const syncInternals = sync as any;

        syncInternals.pendingSettingsScope = scope;
        syncInternals.sessionMaterializedMaxSeqById = {};
        syncInternals.sessionMaterializedMaxSeqDirty = false;

        syncInternals.markSessionMaterializedMaxSeq('session-a', 7);
        syncInternals.flushSessionMaterializedMaxSeq();

        expect(loadSessionMaterializedMaxSeqById(scope)).toEqual({ 'session-a': 7 });
        expect(loadSessionMaterializedMaxSeqById()).toEqual({});
    });

    it('flushes pending session materialization progress before clearing the account/server scope', async () => {
        const scope: AccountSettingsScope = { serverId: 'server-a', accountId: 'account-a' };
        const { sync } = await import('./sync');
        const syncInternals = sync as any;

        syncInternals.pendingSettingsScope = scope;
        syncInternals.sessionMaterializedMaxSeqById = {};
        syncInternals.sessionMaterializedMaxSeqDirty = false;

        syncInternals.markSessionMaterializedMaxSeq('session-a', 9);
        syncInternals.clearActiveAccountSettingsScope();

        expect(loadSessionMaterializedMaxSeqById(scope)).toEqual({ 'session-a': 9 });
        expect(loadSessionMaterializedMaxSeqById()).toEqual({});
        expect(syncInternals.sessionMaterializedMaxSeqById).toEqual({});
        expect(syncInternals.sessionMaterializedMaxSeqFlushTimer).toBeNull();
    });

    it('resets account settings sync status when clearing the account/server scope', async () => {
        const { sync } = await import('./sync');
        const syncInternals = sync as any;

        storage.getState().setAccountSettingsSyncStatus({
            state: 'failed',
            message: 'stale settings sync failure',
            retryable: true,
            kind: 'network',
            at: Date.now(),
        });

        syncInternals.clearActiveAccountSettingsScope();

        expect(storage.getState().accountSettingsSyncStatus).toEqual({ state: 'idle', lastSyncedAt: null });
    });

    it('flushes old session materialization progress before activating a new account/server scope', async () => {
        const { upsertAndActivateServer, getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://server-a.example.test', scope: 'tab' });
        const serverId = String(getActiveServerSnapshot().serverId ?? '').trim();
        expect(serverId).toBeTruthy();

        const oldScope: AccountSettingsScope = { serverId, accountId: 'account-a' };
        const { sync } = await import('./sync');
        const syncInternals = sync as any;

        syncInternals.pendingSettingsScope = oldScope;
        syncInternals.sessionMaterializedMaxSeqById = {};
        syncInternals.sessionMaterializedMaxSeqDirty = false;

        syncInternals.markSessionMaterializedMaxSeq('session-a', 11);
        syncInternals.activateAccountSettingsScope('account-b');

        expect(loadSessionMaterializedMaxSeqById(oldScope)).toEqual({ 'session-a': 11 });
        expect(syncInternals.pendingSettingsScope).toEqual({ serverId, accountId: 'account-b' });
        expect(syncInternals.sessionMaterializedMaxSeqById).toEqual({});
        expect(syncInternals.sessionMaterializedMaxSeqFlushTimer).toBeNull();
    });

    it('resets stale account settings sync status when activating a new account/server scope', async () => {
        const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
        upsertAndActivateServer({ serverUrl: 'https://server-a.example.test', scope: 'tab' });
        const { sync } = await import('./sync');
        const syncInternals = sync as any;

        storage.getState().setAccountSettingsSyncStatus({
            state: 'retrying',
            message: 'previous scope retry',
            retryable: true,
            kind: 'server',
            at: Date.now(),
            failuresCount: 2,
        });

        syncInternals.activateAccountSettingsScope('account-b');

        expect(storage.getState().accountSettingsSyncStatus).toEqual({ state: 'idle', lastSyncedAt: null });
    });

    it('initializes session encryption on the current encryption instance when it changes mid-hydration', async () => {
        const sessionId = 'deep_link_session_swap';
        storage.getState().applySessions([createSession({ sessionId })]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;

        let encryption2Initialized = false;
        const encryption2DecryptMetadata = vi.fn(async () => ({ readStateV1: null }));
        const encryption2DecryptAgentState = vi.fn(async () => ({ controlledByUser: true }));
        const encryption2 = {
            decryptEncryptionKey: async () => new Uint8Array([4, 5, 6]),
            initializeSessions: async () => {
                encryption2Initialized = true;
            },
            getSessionEncryption: (_sessionId: string) =>
                encryption2Initialized ? ({ decryptMetadata: encryption2DecryptMetadata, decryptAgentState: encryption2DecryptAgentState } as any) : null,
        };

        let encryption1Initialized = false;
        const encryption1 = {
            decryptEncryptionKey: async () => new Uint8Array([1, 2, 3]),
            initializeSessions: async () => {
                encryption1Initialized = true;
            },
            getSessionEncryption: (_sessionId: string) =>
                encryption1Initialized
                    ? ({
                          decryptMetadata: async () => {
                              (sync as any).encryption = encryption2 as any;
                              return { readStateV1: null };
                          },
                          decryptAgentState: async () => ({ controlledByUser: true }),
                      } as any)
                    : null,
        };

        (sync as any).encryption = encryption1 as any;

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'dek',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        expect((sync as any).encryption).toBe(encryption2);
        expect(encryption2.getSessionEncryption(sessionId)).not.toBeNull();
    });

    it('re-fetches a known session when forceRefresh is requested', async () => {
        const sessionId = 'known_session_force_refresh';
        storage.getState().applySessions([createSession({ sessionId })]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            initializeSessions: vi.fn(async () => {}),
            getSessionEncryption: vi.fn((_sessionId: string) => ({ decryptMetadata: vi.fn(), decryptAgentState: vi.fn() })),
            decryptEncryptionKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
        };

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'dek',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { forceRefresh: true })).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        const sessionByIdCalls = requestMock.mock.calls.filter(
            (call) => call?.[0] === `/v2/sessions/${sessionId}`,
        );
        expect(sessionByIdCalls).toHaveLength(1);
    });

    it('re-fetches a known encrypted session when the stored record is still partially hydrated', async () => {
        const sessionId = 'known_session_partial_refresh';
        storage.getState().applySessions([createSession({ sessionId })]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        const initializeSessions = vi.fn(async () => {});
        const decryptMetadata = vi.fn(async () => ({ readStateV1: null }));
        const decryptAgentState = vi.fn(async () => ({ controlledByUser: true }));

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
            initializeSessions,
            getSessionEncryption: vi.fn(() => ({ decryptMetadata, decryptAgentState })),
        };

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'dek',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        expect(requestMock).toHaveBeenCalledWith(
            `/v2/sessions/${sessionId}`,
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: 'Bearer t',
                }),
            }),
        );
        expect(initializeSessions).toHaveBeenCalled();
    });

    it('keeps a fully hydrated known encrypted session on the fast path', async () => {
        const sessionId = 'known_session_fast_path';
        storage.getState().applySessions([
            {
                ...createSession({ sessionId }),
                metadataVersion: 1,
                metadata: {
                    path: '/repo',
                    host: 'host',
                    machineId: 'machine-1',
                },
                agentStateVersion: 1,
                agentState: {
                    controlledByUser: true,
                    requests: {},
                    completedRequests: {},
                },
            } as Session,
        ]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
            initializeSessions: vi.fn(async () => {}),
            getSessionEncryption: vi.fn(() => ({ decryptMetadata: vi.fn(), decryptAgentState: vi.fn() })),
        };

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('keeps a known encrypted session with hydrated metadata and null agent state on the fast path', async () => {
        const sessionId = 'known_session_null_agent_state_fast_path';
        storage.getState().applySessions([
            {
                ...createSession({ sessionId }),
                metadataVersion: 1,
                metadata: {
                    path: '/repo',
                    host: 'host',
                    machineId: 'machine-1',
                },
                agentStateVersion: 1,
                agentState: null,
            } as Session,
        ]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
            initializeSessions: vi.fn(async () => {}),
            getSessionEncryption: vi.fn(() => ({ decryptMetadata: vi.fn(), decryptAgentState: vi.fn() })),
        };

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('keeps a fully hydrated known plaintext session on the fast path without an encryption lookup', async () => {
        const sessionId = 'known_plain_session_fast_path';
        storage.getState().applySessions([
            {
                ...createSession({ sessionId }),
                encryptionMode: 'plain',
                metadataVersion: 1,
                metadata: {
                    path: '/repo',
                    host: 'host',
                    machineId: 'machine-1',
                },
                agentStateVersion: 1,
                agentState: {
                    controlledByUser: true,
                    requests: {},
                    completedRequests: {},
                },
            } as Session,
        ]);
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        const getSessionEncryption = vi.fn(() => null);
        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: vi.fn(async () => null),
            initializeSessions: vi.fn(async () => {}),
            getSessionEncryption,
        };

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));
        expect(requestMock).not.toHaveBeenCalled();
        expect(getSessionEncryption).not.toHaveBeenCalled();
    });

    it('falls back to the active server when a route carries a stale unknown server id', async () => {
        const sessionId = 'deep_link_stale_route_server_id';
        const activeServer = upsertServerProfile({ serverUrl: 'http://localhost:52753', name: 'Active' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');

        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: vi.fn(async () => null),
            initializeSessions: vi.fn(async () => {}),
            getSessionEncryption: vi.fn(() => null),
        };

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'plain',
                        dataEncryptionKey: null,
                        metadataVersion: 0,
                        metadata: 'null',
                        agentStateVersion: 0,
                        agentState: null,
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, {
            forceRefresh: true,
            serverId: '127.0.0.1-52753',
        })).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        expect(runtimeFetchMock).not.toHaveBeenCalled();
        expect(requestMock).toHaveBeenCalledWith(
            `/v2/sessions/${sessionId}`,
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: 'Bearer active-token',
                }),
            }),
        );
        expect((sync as any).activeServerSessionIds.has(sessionId)).toBe(true);
    });

    it('hydrates through the preferred owner server when local cache maps the session to a non-active server', async () => {
        const sessionId = 'deep_link_scoped_owner';
        const ownerToken = buildTokenWithSub('owner-account');
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://scoped.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        storage.getState().applySessions([
            {
                ...createSession({ sessionId }),
                encryptionMode: 'plain',
            },
        ]);
        storage.getState().resetSessionMessages(sessionId);
        storage.setState({
            sessionListViewDataByServerId: {
                [ownerServer.id]: [
                    {
                        type: 'session',
                        session: {
                            id: sessionId,
                            seq: 0,
                            createdAt: 1,
                            updatedAt: 2,
                            active: true,
                            activeAt: 2,
                            metadataVersion: 0,
                            agentStateVersion: 1,
                            metadata: {
                                path: '',
                                homeDir: null,
                                host: null,
                                machineId: null,
                                flavor: null,
                                directSessionV1: null,
                            },
                            thinking: false,
                            thinkingAt: 0,
                            presence: 'online',
                            optimisticThinkingAt: null,
                        },
                    },
                ],
            },
        });

        const { sync } = await import('./sync');

        const initializeSessions = vi.fn(async () => {});
        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions,
            getSessionEncryption: vi.fn(() => null),
        };

        requestMock.mockRejectedValue(new Error('active request should not be used'));
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'scoped-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        });
        runtimeFetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'plain',
                        dataEncryptionKey: null,
                        metadataVersion: 0,
                        metadata: 'null',
                        agentStateVersion: 0,
                        agentState: null,
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { forceRefresh: true })).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));

        expect(requestMock).not.toHaveBeenCalled();
        const sessionRequest = runtimeFetchMock.mock.calls.find(
            ([url]) => matchServerFetchUrl(`https://scoped.example/v2/sessions/${sessionId}`).asymmetricMatch(url),
        );
        expect(sessionRequest?.[1]).toEqual(expect.objectContaining({ method: 'GET' }));
        expect(new Headers((sessionRequest?.[1] as RequestInit | undefined)?.headers).get('Authorization'))
            .toBe(`Bearer ${ownerToken}`);
        expect((sync as any).activeServerSessionIds.has(sessionId)).toBe(true);
        expect(initializeSessions).not.toHaveBeenCalled();
    });

    it('does not return an active Home session when an explicit foreign server owns the same id', async () => {
        const sessionId = 'same_id_on_two_homes';
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://scoped.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        storage.getState().applySessions([{
            ...createSession({ sessionId }),
            serverId: activeServer.id,
            encryptionMode: 'plain',
            metadata: { path: '/active', machineId: 'active-machine', host: 'active.example' },
        }]);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };
        requestMock.mockRejectedValue(new Error('active request should not be used'));
        getCredentialsForServerUrlMock.mockResolvedValue({
            token: buildTokenWithSub('owner-account'),
            secret: 'scoped-secret',
        });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        });
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            session: {
                id: sessionId,
                createdAt: 1,
                updatedAt: 2,
                seq: 3,
                active: true,
                activeAt: 2,
                encryptionMode: 'plain',
                dataEncryptionKey: null,
                metadataVersion: 1,
                metadata: JSON.stringify({ path: '/owner', machineId: 'owner-machine' }),
                agentStateVersion: 0,
                agentState: null,
                share: null,
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { serverId: ownerServer.id }))
            .resolves.toEqual(expect.objectContaining({ kind: 'available', serverId: ownerServer.id }));
        expect(requestMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock.mock.calls.some(([url]) =>
            matchServerFetchUrl(`https://scoped.example/v2/sessions/${sessionId}`).asymmetricMatch(url))).toBe(true);
        expect(storage.getState().sessions[sessionId]).toEqual(expect.objectContaining({
            serverId: ownerServer.id,
            metadata: expect.objectContaining({ path: '/owner', machineId: 'owner-machine' }),
        }));
    });

    it('does not return a stored foreign session when the active Home owns the same id', async () => {
        const sessionId = 'same_id_foreign_record';
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const foreignServer = upsertServerProfile({ serverUrl: 'https://foreign.example', name: 'Foreign' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        storage.getState().applySessions([{
            ...createSession({ sessionId }),
            serverId: foreignServer.id,
            encryptionMode: 'plain',
            metadata: { path: '/foreign', machineId: 'foreign-machine', host: 'foreign.example' },
        }]);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };
        requestMock.mockResolvedValue(new Response(JSON.stringify({
            session: {
                id: sessionId,
                createdAt: 1,
                updatedAt: 2,
                seq: 3,
                active: true,
                activeAt: 2,
                encryptionMode: 'plain',
                dataEncryptionKey: null,
                metadataVersion: 1,
                metadata: JSON.stringify({ path: '/active', machineId: 'active-machine' }),
                agentStateVersion: 0,
                agentState: null,
                share: null,
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { serverId: activeServer.id }))
            .resolves.toEqual(expect.objectContaining({ kind: 'available', serverId: activeServer.id }));
        expect(requestMock).toHaveBeenCalled();
        expect(storage.getState().sessions[sessionId]).toEqual(expect.objectContaining({
            serverId: activeServer.id,
            metadata: expect.objectContaining({ path: '/active', machineId: 'active-machine' }),
        }));
    });

    it('prepares Same Setup from the clicked thin row through its exact foreign server', async () => {
        const sessionId = 'clicked_foreign_session';
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const foreignServer = upsertServerProfile({ serverUrl: 'https://foreign.example', name: 'Foreign' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        storage.setState({ profileScope: { serverId: activeServer.id, accountId: 'active-account' } });
        storage.getState().applySessions([{
            ...createSession({ sessionId: 'selected_active_session' }),
            serverId: activeServer.id,
            encryptionMode: 'plain',
            metadata: { path: '/active/other', machineId: 'active-machine', host: 'active.example', flavor: 'claude' },
        }, {
            ...createSession({ sessionId }),
            serverId: foreignServer.id,
            encryptionMode: 'plain',
            metadata: null,
        }]);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set(['selected_active_session']);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };
        requestMock.mockRejectedValue(new Error('active request should not be used'));
        getCredentialsForServerUrlMock.mockResolvedValue({
            token: buildTokenWithSub('foreign-account'),
            secret: 'foreign-secret',
        });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        });
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            session: {
                id: sessionId,
                createdAt: 1,
                updatedAt: 2,
                seq: 3,
                active: true,
                activeAt: 2,
                encryptionMode: 'plain',
                dataEncryptionKey: null,
                metadataVersion: 1,
                metadata: JSON.stringify({
                    path: '/foreign/worktree', machineId: 'foreign-machine', flavor: 'codex',
                    profileId: 'foreign-profile', transcriptStorage: 'direct',
                }),
                agentStateVersion: 0,
                agentState: null,
                share: null,
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const { prepareNewSessionSameSetupFromRow } = await import('@/components/sessions/new/navigation/newSessionSameSetup');
        const prepared = await prepareNewSessionSameSetupFromRow({ sessionId, serverId: foreignServer.id });
        expect(requestMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock.mock.calls.some(([url]) =>
            matchServerFetchUrl(`https://foreign.example/v2/sessions/${sessionId}`).asymmetricMatch(url))).toBe(true);
        expect(prepared.kind).toBe('ready');
        if (prepared.kind !== 'ready') return;
        expect(prepared.route).toEqual({
            pathname: '/new',
            params: expect.objectContaining({
                machineId: 'foreign-machine', directory: '/foreign/worktree',
                spawnServerId: foreignServer.id, dataId: expect.any(String),
            }),
        });
        const seed = peekTempData<NewSessionData>(prepared.route.params.dataId);
        expect(seed).toEqual(expect.objectContaining({
            prompt: '', machineId: 'foreign-machine', directory: '/foreign/worktree',
            agentType: 'codex', selectedProfileId: 'foreign-profile', transcriptStorage: 'direct',
            replacePersistedDraftSelections: true,
        }));
        expect(seed?.resumeSessionId).toBeUndefined();
        expect(seed?.sourceContext).toBeUndefined();
        expect(seed?.checkoutCreationDraft).toBeNull();

        // A full cached row from a previous login to this Home has no account stamp.
        // Clicking it must fetch the current owner's setup instead of copying old metadata.
        getCredentialsForServerUrlMock.mockResolvedValue({
            token: buildTokenWithSub('next-foreign-account'), secret: 'next-foreign-secret',
        });
        runtimeFetchMock.mockClear();
        runtimeFetchMock.mockImplementation(async () => new Response(JSON.stringify({
            session: {
                id: sessionId, createdAt: 1, updatedAt: 3, seq: 4,
                active: true, activeAt: 3, encryptionMode: 'plain', dataEncryptionKey: null,
                metadataVersion: 2,
                metadata: JSON.stringify({
                    path: '/foreign/next-account', machineId: 'next-machine', flavor: 'claude',
                    profileId: 'next-profile',
                }),
                agentStateVersion: 0, agentState: null, share: null,
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const nextPrepared = await prepareNewSessionSameSetupFromRow({ sessionId, serverId: foreignServer.id });
        expect(runtimeFetchMock).toHaveBeenCalled();
        expect(storage.getState().sessions[sessionId]?.metadata?.path).toBe('/foreign/next-account');
        expect(nextPrepared.kind).toBe('ready');
        if (nextPrepared.kind !== 'ready') return;
        expect(nextPrepared.route.params).toEqual(expect.objectContaining({
            machineId: 'next-machine', directory: '/foreign/next-account', spawnServerId: foreignServer.id,
        }));
        expect(peekTempData<NewSessionData>(nextPrepared.route.params.dataId))
            .toEqual(expect.objectContaining({ agentType: 'claude', selectedProfileId: 'next-profile' }));
    });

    it.each(['new-account', 'old-account', 'active-reset'])('commits foreign hydration only while the captured account is current (%s)', async (nextAccount) => {
        const { createDeferred } = await import('@/dev/testkit');
        const { voiceHooks } = await import('@/voice/context/voiceHooks');
        vi.mocked(voiceHooks.onAgentRequest).mockClear();
        const validationStarted = createDeferred<void>();
        const validationReady = createDeferred<void>();
        let credentialReads = 0;
        const sessionId = 'foreign_account_changed_during_hydration';
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const foreignServer = upsertServerProfile({ serverUrl: 'https://foreign.example', name: 'Foreign' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        };
        requestMock.mockRejectedValue(new Error('active request should not be used'));
        let foreignToken = buildTokenWithSub('old-account');
        getCredentialsForServerUrlMock.mockImplementation(async () => {
            if (++credentialReads === 2 && nextAccount === 'active-reset') {
                validationStarted.resolve();
                await validationReady.promise;
            }
            return { token: foreignToken, secret: 'foreign-secret' };
        });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => null,
            initializeSessions: async () => {},
            getSessionEncryption: () => null,
        });

        let startRequest: (() => void) | undefined;
        const requestStarted = new Promise<void>((resolve) => { startRequest = resolve; });
        let finishRequest: ((response: Response) => void) | undefined;
        const pendingResponse = new Promise<Response>((resolve) => { finishRequest = resolve; });
        runtimeFetchMock.mockImplementation(async () => {
            startRequest?.();
            return await pendingResponse;
        });

        const hydration = sync.ensureSessionVisibleForMessageRoute(sessionId, {
            serverId: foreignServer.id,
            forceRefresh: true,
        });
        await requestStarted;
        foreignToken = buildTokenWithSub(nextAccount === 'active-reset' ? 'old-account' : nextAccount) + '-rotated';
        finishRequest?.(new Response(JSON.stringify({
            session: {
                id: sessionId, createdAt: 1, updatedAt: 2, seq: 3,
                active: true, activeAt: 2, encryptionMode: 'plain', dataEncryptionKey: null,
                metadataVersion: 1,
                metadata: JSON.stringify({ path: '/old-account', host: 'foreign.example', machineId: 'old-machine' }),
                agentStateVersion: 1, agentState: JSON.stringify({ requests: { req: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { question: 'Proceed?' }, createdAt: 1 } } }), share: null,
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        if (nextAccount === 'active-reset') {
            await validationStarted.promise;
            sync.disconnectServer();
            (sync as any).sessionDataKeys.set(sessionId, new Uint8Array([7]));
            (sync as any).sessionDataKeyEnvelopes.set(sessionId, 'current-envelope');
            validationReady.resolve();
        }
        const result = await hydration;
        if (nextAccount === 'old-account') {
            expect(storage.getState().sessions[sessionId]?.metadata?.path).toBe('/old-account');
            expect(result).toMatchObject({ kind: 'available' });
            expect(voiceHooks.onAgentRequest).toHaveBeenCalledOnce();
        } else {
            expect(storage.getState().sessions[sessionId]).toBeUndefined();
            expect(result).toMatchObject({ kind: 'retryable_failure' });
            expect(voiceHooks.onAgentRequest).not.toHaveBeenCalled();
        }
        if (nextAccount === 'active-reset') {
            expect((sync as any).sessionDataKeys.get(sessionId)).toEqual(new Uint8Array([7]));
            expect((sync as any).sessionDataKeyEnvelopes.get(sessionId)).toBe('current-envelope');
        }
        expect(requestMock).not.toHaveBeenCalled();
    });

    it.each(['new-account', 'old-account', 'declined'])('stages encrypted hydration keys through account validation after decryption (%s)', async (nextAccount) => {
        const { createDeferred } = await import('@/dev/testkit');
        const { voiceHooks } = await import('@/voice/context/voiceHooks');
        vi.mocked(voiceHooks.onAgentRequest).mockClear();
        const { fetchSessionByIdWithServerScope } = await import('./runtime/orchestration/serverScopedRpc/fetchSessionByIdWithServerScope');
        const active = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const foreign = upsertServerProfile({ serverUrl: 'https://foreign.example', name: 'Foreign' });
        setActiveServerId(active.id, { scope: 'device' });
        let token = buildTokenWithSub('old-account');
        getCredentialsForServerUrlMock.mockImplementation(async () => ({ token, secret: 'foreign-secret' }));
        const decryptStarted = createDeferred<void>();
        const metadata = createDeferred<{ path: string; host: string }>();
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => new Uint8Array([9]),
            initializeSessions: async () => {},
            getSessionEncryption: () => ({
                decryptMetadata: async () => { decryptStarted.resolve(); return await metadata.promise; },
                decryptAgentState: async () => ({ requests: { req: { tool: 'AskUserQuestion', kind: 'user_action', arguments: { question: 'Proceed?' }, createdAt: 1 } } }),
            }),
        });
        const sessionId = 'foreign_encrypted_pending';
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({ session: {
            id: sessionId, createdAt: 1, updatedAt: 2, seq: 3, active: true, activeAt: 2,
            encryptionMode: 'e2ee', dataEncryptionKey: 'new-envelope', metadataVersion: 1,
            metadata: 'encrypted', agentStateVersion: 0, agentState: null, share: null,
        } }), { status: 200 }));
        const keys = new Map([[sessionId, new Uint8Array([1])], ['unrelated', new Uint8Array([2])]]);
        const envelopes = new Map([[sessionId, 'old-envelope'], ['unrelated', 'other-envelope']]);
        const applySessions = vi.fn(() => nextAccount === 'declined' ? false : undefined);
        const hydration = fetchSessionByIdWithServerScope({
            sessionId, serverId: foreign.id, activeCredentials: { token: 'unused', secret: '' },
            sessionDataKeys: keys, sessionDataKeyEnvelopes: envelopes,
            activeRequest: requestMock, applySessions, log: { log: vi.fn() }, includeTurnsProjection: false,
        });
        await decryptStarted.promise;
        expect(keys.get(sessionId)).toEqual(new Uint8Array([1]));
        expect(envelopes.get(sessionId)).toBe('old-envelope');
        token = buildTokenWithSub(nextAccount === 'declined' ? 'old-account' : nextAccount) + '-rotated';
        metadata.resolve({ path: '/old-account', host: 'foreign.example' });
        const result = await hydration;
        expect(result.ok).toBe(nextAccount === 'old-account');
        if (nextAccount === 'old-account') {
            expect(applySessions).toHaveBeenCalledOnce();
            expect(voiceHooks.onAgentRequest).toHaveBeenCalledOnce();
            expect(keys.get(sessionId)).toEqual(new Uint8Array([9]));
            expect(envelopes.get(sessionId)).toBe('new-envelope');
        } else {
            expect(result.errorCode).toBe('stale_context');
            expect(applySessions).toHaveBeenCalledTimes(nextAccount === 'declined' ? 1 : 0);
            expect(voiceHooks.onAgentRequest).not.toHaveBeenCalled();
            expect(keys.get(sessionId)).toEqual(new Uint8Array([1]));
            expect(envelopes.get(sessionId)).toBe('old-envelope');
        }
        expect(keys.get('unrelated')).toEqual(new Uint8Array([2]));
        expect(envelopes.get('unrelated')).toBe('other-envelope');
    });

    it('ignores localStorage read errors while evaluating debug hydration logging', async () => {
        const sessionId = 'deep_link_local_storage_error';
        storage.getState().applySessions([
            {
                ...createSession({ sessionId }),
                metadataVersion: 1,
                metadata: {
                    path: '/repo',
                    host: 'host',
                    machineId: 'machine-1',
                },
                agentStateVersion: 1,
                agentState: {
                    controlledByUser: true,
                    requests: {},
                    completedRequests: {},
                },
            } as Session,
        ]);

        const localStorageMock = {
            getItem: vi.fn(() => {
                throw new Error('storage blocked');
            }),
        };
        vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 't' };
        (sync as any).activeServerSessionIds = new Set<string>([sessionId]);
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = true;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => new Uint8Array([1, 2, 3]),
            initializeSessions: async () => {},
            getSessionEncryption: vi.fn(() => ({ decryptMetadata: vi.fn(), decryptAgentState: vi.fn() })),
        };

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
        }));
        expect(localStorageMock.getItem).toHaveBeenCalledWith('happier.debug.sessionHydrate');
    });

    it('initializes encrypted explicit-server route hydration with the owner server scope', async () => {
        const sessionId = 'deep_link_explicit_server_encrypted';
        const ownerToken = buildTokenWithSub('owner-account');
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://scoped.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');
        const initializeSessions = vi.fn<(
            keys: Map<string, Uint8Array | null>,
            scope?: Readonly<{ serverId?: string | null }>,
        ) => Promise<void>>(async () => {});
        const scopedInitializeSessions = vi.fn(async () => {});

        (sync as any).credentials = { token: 'active-token', secret: 'active-secret' };
        (sync as any).activeServerSessionIds = new Set<string>();
        (sync as any).hasFetchedSessionsSnapshotForActiveServer = false;
        (sync as any).encryption = {
            decryptEncryptionKey: async () => new Uint8Array([1, 2, 3]),
            initializeSessions,
            getSessionEncryption: () => null,
        };

        requestMock.mockRejectedValue(new Error('active request should not be used'));
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'scoped-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({
            decryptEncryptionKey: async () => new Uint8Array([1, 2, 3]),
            initializeSessions: scopedInitializeSessions,
            getSessionEncryption: () => ({
                decryptMetadata: async () => ({ path: '/repo', host: 'owner' }),
                decryptAgentState: async () => ({ controlledByUser: true }),
            }),
        });
        runtimeFetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    session: {
                        id: sessionId,
                        createdAt: 1,
                        updatedAt: 2,
                        seq: 3,
                        active: true,
                        activeAt: 2,
                        encryptionMode: 'e2ee',
                        dataEncryptionKey: 'dek',
                        metadataVersion: 1,
                        metadata: 'enc-meta',
                        agentStateVersion: 1,
                        agentState: 'enc-state',
                        share: null,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId, { forceRefresh: true, serverId: ownerServer.id })).resolves.toEqual(expect.objectContaining({
            kind: 'available',
            sessionId,
            serverId: ownerServer.id,
        }));

        expect(requestMock).not.toHaveBeenCalled();
        expect(scopedInitializeSessions).toHaveBeenCalled();
        expect(initializeSessions).toHaveBeenCalledTimes(1);
        expect(initializeSessions.mock.calls[0]?.[0].get(sessionId)).toEqual(new Uint8Array([1, 2, 3]));
        expect(initializeSessions.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            serverId: ownerServer.id,
        }));
    });

    it('records terminal auth and stops route hydration when session-by-id returns 401', async () => {
        const sessionId = 'deep_link_auth_failed';
        storage.getState().resetSessionMessages(sessionId);

        const { sync } = await import('./sync');
        (sync as any).credentials = { token: 't' };

        requestMock.mockResolvedValue(
            new Response(
                JSON.stringify({ error: 'auth failed' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(sync.ensureSessionVisibleForMessageRoute(sessionId)).resolves.toEqual(expect.objectContaining({
            kind: 'missing',
            sessionId,
            cause: 'unauthorized',
        }));

        expect(storage.getState().syncError).toMatchObject({
            kind: 'auth',
            retryable: false,
            message: 'Authentication required',
        });
    });
});
