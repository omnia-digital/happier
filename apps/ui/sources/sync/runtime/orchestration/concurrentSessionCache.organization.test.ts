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
        credentials = accountChanged ? credentialsFor('replacement-account') : {
            token: `rotated.${Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64')}.new-signature`,
        };
        release(new Response(JSON.stringify({ snapshot: snapshot(9, ['B', 'A2', 'A']) })));
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getState().sessionOrganizationSnapshotVersionByServerId[remote.id]).toBe(accountChanged ? 7 : 9);
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'replacement-account')).toBeNull();
        expect(loadSessionOrganizationWarmCacheSnapshot(remote.id, 'account-b')?.version).toBe(accountChanged ? 7 : 9);
    });

});
