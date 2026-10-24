import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionOrganizationSnapshot } from '@happier-dev/protocol';
import { createSocketHarness } from '@/dev/testkit/harness/socketHarness';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import * as profiles from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storageStore';
import { prepareWarmCacheStorage, loadSessionOrganizationWarmCacheSnapshot, saveSessionOrganizationWarmCacheSnapshot } from '@/sync/domains/state/warmCachePersistence';
import { startConcurrentSessionCacheSync, stopConcurrentSessionCacheSync } from './concurrentSessionCache';

const boundary = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: (...args: unknown[]) => boundary.fetch(...args) }));
vi.mock('socket.io-client', () => ({ io: () => {
    const events = createSocketHarness<Record<string, unknown>>();
    const socket = { connected: false, on: events.on, off: events.off,
        connect: () => { socket.connected = true; events.emit('connect', undefined); },
        disconnect: () => { socket.connected = false; }, removeAllListeners: () => {},
    };
    return socket;
} }));

const credentialsFor = (account: string) => ({ token: `header.${Buffer.from(JSON.stringify({ sub: account })).toString('base64')}.signature` });
function snapshot(version: number, sessionIds: string[]): SessionOrganizationSnapshot {
    return { schemaVersion: 1, version, pins: [], folders: [], folderAssignments: [], tags: [], tagAssignments: [], labels: [],
        orderEntries: sessionIds.map((id, index) => ({ scopeKind: 'group', scopeKey: 'repository-order', itemKind: 'session', itemKey: id, sortKey: String(index).padStart(8, '0') })),
    };
}
let previous: ReturnType<typeof storage.getState>;
let remote: ReturnType<typeof profiles.upsertServerProfile>;
let credentials = credentialsFor('account-b');
beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `concurrent-organization-${Math.random()}`);
    await prepareWarmCacheStorage();
    previous = storage.getState();
    storage.setState(storage.getInitialState(), true);
    const active = profiles.upsertServerProfile({ serverUrl: 'https://organization-active.example.test' });
    remote = profiles.upsertServerProfile({ serverUrl: 'https://organization-remote.example.test' });
    profiles.setActiveServerId(active.id, { scope: 'device' });
    credentials = credentialsFor('account-b');
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async () => credentials);
    boundary.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    storage.setState(state => ({ settings: { ...state.settings,
        serverSelectionGroups: [{ id: 'both', name: 'Both', serverIds: [active.id, remote.id], presentation: 'grouped' }],
        serverSelectionActiveTargetKind: 'group', serverSelectionActiveTargetId: 'both',
    } }));
});
afterEach(() => {
    stopConcurrentSessionCacheSync();
    storage.setState(previous, true);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe('concurrent Home organization lifecycle', () => {
    it('keeps foreign ticket metadata in its fully hydrated Home cache without replacing an active same-ID session', async () => {
        const { createSessionFixture } = await import('@/dev/testkit');
        const { buildSessionListRenderableFromSession } = await import('@/sync/domains/session/listing/sessionListRenderable');
        const { createSessionListStatusInputsSelector } = await import('@/components/sessions/shell/view-state/sessionListStatusInputs');
        const { projectSessionListStatusView } = await import('@/components/sessions/shell/view-state/projectSessionListStatusView');
        const { sync } = await import('@/sync/sync');
        const { Encryption } = await import('@/sync/encryption/encryption');
        const activeServerId = profiles.getActiveServerId();
        const link = (workspaceId: string) => ({ v: 1 as const, ticket: { v: 1 as const, provider: 'linear' as const, workspaceId, ticketId: workspaceId, key: 'DEV-1', title: workspaceId, url: `https://linear.app/${workspaceId}/issue/DEV-1` }, reader: { machineId: 'reader', mcpServerId: 'source', directory: '/repo' } });
        const active = createSessionFixture({ id: 'same-status-id', serverId: activeServerId, encryptionMode: 'plain', metadata: { path: '/active', host: 'active', sessionTicketV1: link('active') } });
        storage.getState().applySessions([active]);
        const activeRow = { type: 'session' as const, serverId: activeServerId, session: buildSessionListRenderableFromSession(active) };
        const foreignRow = { id: active.id, seq: 0, createdAt: 1, updatedAt: 2, active: false, activeAt: 2, archivedAt: null,
            encryptionMode: 'plain', dataEncryptionKey: null, metadata: JSON.stringify({ path: '/foreign', host: 'foreign', sessionTicketV1: link('foreign') }), metadataVersion: 1, agentState: null, agentStateVersion: 0, share: null };
        boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes(`/v2/sessions/${active.id}`)) return new Response(JSON.stringify({ session: foreignRow }));
            if (url.includes('/v2/sessions')) return new Response(JSON.stringify({ sessions: [foreignRow], hasNext: false }));
            if (url.includes('/v1/machines')) return new Response('[]');
            if (url.includes('/v2/session-organization')) return new Response('{"error":"Not found"}', { status: 404 });
            return new Response('{"ok":true}');
        });
        startConcurrentSessionCacheSync(); await vi.advanceTimersByTimeAsync(1_000);
        const foreignItems = storage.getState().sessionListViewDataByServerId[remote.id]!;
        expect(foreignItems.some(item => item.type === 'session' && item.session.metadata?.sessionTicketV1?.ticket.workspaceId === 'foreign')).toBe(true);
        const owner = sync as unknown as { credentials: unknown; encryption: unknown; ensureSessionListMetadata: (rows: readonly { sessionId: string; serverId: string }[], current: () => boolean) => Promise<unknown[]> };
        owner.credentials = { ...credentialsFor('active-account'), secret: 'isolated-secret' }; owner.encryption = await Encryption.create(new Uint8Array(32).fill(8));
        try {
            expect(await owner.ensureSessionListMetadata([{ sessionId: active.id, serverId: remote.id }], () => true)).toEqual([null]);
            expect(storage.getState().sessions[active.id]?.metadata?.path).toBe('/active');
            expect(storage.getState().sessionListViewDataByServerId[remote.id]).toBe(foreignItems);
            const items = [activeRow, ...foreignItems];
            const inputs = createSessionListStatusInputsSelector(items, activeServerId, () => 100_000, false)(storage.getState());
            expect(inputs.ticketAssociations.get(`${activeServerId}:${active.id}`)?.ticket.workspaceId).toBe('active');
            expect(inputs.ticketAssociations.get(`${remote.id}:${active.id}`)?.ticket.workspaceId).toBe('foreign');
            const statuses = new Map([...inputs.ticketAssociations].flatMap(([key, association]) => association ? [[key, { phase: 'ready' as const, error: null, snapshot: { ticket: association.ticket, status: { name: 'Custom QA', workflowId: 'workflow', order: 1 }, fetchedAt: 100_000 } }] as const] : []));
            const grouped = projectSessionListStatusView({ items, grouping: 'ticket', sorting: 'none', ticketStatuses: statuses, ticketAssociations: inputs.ticketAssociations, nowMs: 100_000 });
            expect(grouped.filter(item => item.type === 'session')).toHaveLength(2);
            expect(grouped.flatMap(item => item.type === 'header' && item.headerKind === 'status' ? [item.subtitle] : [])).toEqual(['linear · active · workflow', 'linear · foreign · workflow']);
        } finally { sync.disconnectServer(); }
    });
    it('restores the selected foreign account order before its refresh and never borrows another account snapshot', async () => {
        saveSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b', snapshot(7, ['A', 'B', 'A2']));
        saveSessionOrganizationWarmCacheSnapshot(remote.id, 'other-account', snapshot(90, ['private-other']));
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b')?.version).toBe(7);
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBe(7);
        expect(storage.getState().sessionOrganizationOrderEntriesByScopeKey[`${remote.id}:group:repository-order`]?.map(entry => entry.itemKey)).toEqual(['A', 'B', 'A2']);
        stopConcurrentSessionCacheSync();
        credentials = credentialsFor('replacement-account');
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBeUndefined();
        expect(storage.getState().sessionOrganizationOrderEntriesByScopeKey[`${remote.id}:group:repository-order`]).toBeUndefined();
    });
    it('refreshes the foreign organization through its authenticated route and persists that account order', async () => {
        saveSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b', snapshot(7, ['A', 'B', 'A2']));
        boundary.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/v2/session-organization')) {
                expect(url.startsWith(remote.serverUrl)).toBe(true);
                expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${credentials.token}`);
                return new Response(JSON.stringify({ snapshot: snapshot(9, ['B', 'A2', 'A']) }));
            }
            if (url.includes('/v2/sessions')) return new Response(JSON.stringify({ sessions: [], hasNext: false }));
            if (url.includes('/v1/machines')) return new Response('[]');
            return new Response(JSON.stringify({ ok: true }));
        });
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBe(9);
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b')?.orderEntries.map(entry => entry.itemKey)).toEqual(['B', 'A2', 'A']);
        stopConcurrentSessionCacheSync();
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBe(9);
    });

    it.each([false, true])('checks captured account before publishing a delayed organization response (account changed: %s)', async (accountChanged) => {
        saveSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b', snapshot(7, ['A', 'B', 'A2']));
        let release!: (response: Response) => void;
        const response = new Promise<Response>(resolve => { release = resolve; });
        let organizationRequested = false;
        boundary.fetch.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/v2/session-organization')) { organizationRequested = true; return response; }
            if (url.includes('/v2/sessions')) return new Response(JSON.stringify({ sessions: [], hasNext: false }));
            if (url.includes('/v1/machines')) return new Response('[]');
            return new Response(JSON.stringify({ ok: true }));
        });
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(organizationRequested).toBe(true);
        expect(storage.getState().sessionListViewDataByServerId[remote.id]).toEqual([]);
        expect(storage.getState().machineListStatusByServerId[remote.id]).toBe('idle');
        credentials = accountChanged ? credentialsFor('replacement-account') : {
            token: `rotated.${Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64')}.new-signature`,
        };
        release(new Response(JSON.stringify({ snapshot: snapshot(9, ['B', 'A2', 'A']) })));
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBe(accountChanged ? 7 : 9);
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'replacement-account')).toBeNull();
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b')?.version).toBe(accountChanged ? 7 : 9);
    });

    it('does not persist a replacement account projection under the stopped connection account', async () => {
        saveSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b', snapshot(7, ['A', 'B', 'A2']));
        startConcurrentSessionCacheSync();
        await vi.advanceTimersByTimeAsync(0);
        credentials = credentialsFor('replacement-account');
        storage.getState().applySessionOrganizationSnapshot(remote.id, snapshot(99, ['replacement-private']));
        stopConcurrentSessionCacheSync();
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b')?.version).toBe(7);
    });

});
