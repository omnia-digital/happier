import { afterEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    reachability: new Map<string, (state: any) => void>(),
    requests: [] as string[],
    account: 'account-a',
    holdCursor: null as string | null,
    releaseHeldPage: null as (() => void) | null,
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>(),
    reportServerUnreachable: vi.fn(),
    startServerReachabilitySupervisor: vi.fn(async () => {}),
    stopServerReachabilitySupervisor: vi.fn(async () => {}),
    subscribeServerReachabilityState: (url: string, callback: (state: any) => void) => {
        boundary.reachability.set(url, callback);
        return () => boundary.reachability.delete(url);
    },
}));

vi.mock('./concurrentServerConnections/createConcurrentServerSocketTransport', () => ({
    createConcurrentServerSocketTransport: () => {
        let onConnected: (() => void) | null = null;
        return {
            socket: {},
            transport: {
                isConnected: () => false,
                connect: async () => { onConnected?.(); },
                disconnect: async () => {},
                destroy: async () => {},
                onConnected: (callback: () => void) => { onConnected = callback; return () => {}; },
                onDisconnected: () => () => {},
                onError: () => () => {},
            },
        };
    },
}));

function sessionRow(id: string, name: string) {
    return {
        id, seq: 1, createdAt: 1, updatedAt: 1, active: false, activeAt: 1,
        archivedAt: null, encryptionMode: 'plain',
        metadata: JSON.stringify({ name, path: `/work/${id}`, host: 'test-host', machineId: 'machine-a' }),
        metadataVersion: 1, agentState: null, agentStateVersion: 0,
        dataEncryptionKey: null, share: null,
    };
}

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: async ({ url }: { url: string }) => {
        const path = new URL(url).pathname + new URL(url).search;
        boundary.requests.push(path);
        if (path === '/v2/sessions?limit=50') {
            return new Response(JSON.stringify({
                sessions: Array.from({ length: 50 }, (_, index) => sessionRow(`recent-${index}`, `Recent ${index}`)),
                nextCursor: 'older', hasNext: true,
            }), { status: 200 });
        }
        if (path === '/v2/sessions?limit=50&cursor=older') {
            if (boundary.holdCursor === 'older') {
                await new Promise<void>((resolve) => { boundary.releaseHeldPage = resolve; });
            }
            return new Response(JSON.stringify({
                sessions: [sessionRow('target', `${boundary.account} older title`)],
                nextCursor: 'oldest', hasNext: true,
            }), { status: 200 });
        }
        if (path === '/v2/sessions?limit=50&cursor=oldest') {
            return new Response(JSON.stringify({ sessions: [], nextCursor: null, hasNext: false }), { status: 200 });
        }
        if (path === '/v1/machines') return new Response('[]', { status: 200 });
        if (path.startsWith('/v2/session-organization')) {
            return new Response('{"error":"Not found"}', { status: 404 });
        }
        return new Response('{}', { status: 404 });
    },
}));

async function setup() {
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    const { storage } = await import('@/sync/domains/state/storageStore');
    const profiles = await import('@/sync/domains/server/serverProfiles');
    const owner = await import('./concurrentSessionCache');
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `oh56-cache-${Math.random()}`);
    const active = profiles.upsertServerProfile({ serverUrl: 'https://oh56-active.example.test' });
    const remote = profiles.upsertServerProfile({ serverUrl: 'https://oh56-remote.example.test' });
    profiles.setActiveServerId(active.id, { scope: 'device' });
    profiles.setServerProfileIdentityForUrl(remote.serverUrl, 'srv_oh56_remote');
    storage.setState(storage.getInitialState(), true);
    storage.setState((state) => ({
        settings: {
            ...state.settings,
            serverSelectionGroups: [{ id: 'both', name: 'Both', serverIds: [active.id, 'srv_oh56_remote'], presentation: 'grouped' }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'both',
        },
    }));
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async (url) =>
        url.includes('remote')
            ? { token: `header.${btoa(JSON.stringify({ sub: boundary.account }))}.signature` }
            : null,
    );
    expect(owner.resolveConcurrentTargets({
        activeServerId: active.id,
        profiles: profiles.listServerProfiles(),
        settings: storage.getState().settings,
    })).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'srv_oh56_remote' })]));
    owner.startConcurrentSessionCacheSync();
    await vi.waitFor(() => expect(boundary.reachability.size).toBe(1));
    for (const callback of boundary.reachability.values()) callback({ phase: 'online' });
    await vi.waitFor(() => expect(storage.getState().sessionListViewDataByServerId['srv_oh56_remote']?.filter((item) => item.type === 'session').length).toBe(50), { timeout: 10_000 });
    return { storage, owner, active };
}

afterEach(async () => {
    boundary.releaseHeldPage?.();
    boundary.reachability.clear();
    boundary.requests = [];
    boundary.account = 'account-a';
    boundary.holdCursor = null;
    boundary.releaseHeldPage = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('selected-Home command palette title paging', () => {
    it('publishes older decrypted titles through the selected Home cache and stops dispatch after query clear', async () => {
        const { storage, owner } = await setup();
        try {
            let searching = true;
            boundary.holdCursor = 'older';
            const search = owner.fetchRemainingSelectedServerSessions(['srv_oh56_remote'], () => searching);
            await vi.waitFor(() => expect(boundary.requests).toContain('/v2/sessions?limit=50&cursor=older'));
            searching = false;
            boundary.releaseHeldPage?.();
            await search;
            expect(boundary.requests).not.toContain('/v2/sessions?limit=50&cursor=oldest');
            expect(storage.getState().sessionListViewDataByServerId['srv_oh56_remote']?.filter((item) => item.type === 'session')).toHaveLength(50);

            boundary.holdCursor = null;
            await owner.fetchRemainingSelectedServerSessions(['srv_oh56_remote'], () => true);
            expect(boundary.requests).toContain('/v2/sessions?limit=50&cursor=oldest');
            expect(storage.getState().sessionListViewDataByServerId['srv_oh56_remote']).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'session', session: expect.objectContaining({ id: 'target' }) }),
            ]));
        } finally {
            owner.stopConcurrentSessionCacheSync();
        }
    });

    it('does not publish an old account page after selected Home credentials change', async () => {
        const { storage, owner, active } = await setup();
        try {
            boundary.holdCursor = 'older';
            const search = owner.fetchRemainingSelectedServerSessions(['srv_oh56_remote'], () => true);
            await vi.waitFor(() => expect(boundary.requests).toContain('/v2/sessions?limit=50&cursor=older'));
            boundary.account = 'account-b';
            storage.setState((state) => ({ settings: { ...state.settings, serverSelectionActiveTargetKind: 'server', serverSelectionActiveTargetId: active.id } }));
            await vi.waitFor(() => expect(boundary.reachability.size).toBe(0));
            boundary.holdCursor = null;
            storage.setState((state) => ({ settings: { ...state.settings, serverSelectionActiveTargetKind: 'group', serverSelectionActiveTargetId: 'both' } }));
            await vi.waitFor(() => expect(boundary.reachability.size).toBe(1));
            for (const callback of boundary.reachability.values()) callback({ phase: 'online' });
            await vi.waitFor(() => expect(storage.getState().sessionListViewDataByServerId['srv_oh56_remote']?.filter((item) => item.type === 'session').length).toBe(50));
            await owner.fetchRemainingSelectedServerSessions(['srv_oh56_remote'], () => true);
            boundary.releaseHeldPage?.();
            await search;
            expect(storage.getState().sessionListViewDataByServerId['srv_oh56_remote']).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'session', session: expect.objectContaining({
                    id: 'target', metadata: expect.objectContaining({ name: 'account-b older title' }),
                }) }),
            ]));
        } finally {
            owner.stopConcurrentSessionCacheSync();
        }
    });
});
