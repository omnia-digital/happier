import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { AccountProfileSchema, PUSH_NOTIFICATION_ACTION_IDS, V2SessionByIdResponseSchema } from '@happier-dev/protocol';

import { createOkFetchResponse, createServerFetchWithReachabilityProbe, getServerFetchUrl, renderHook } from '@/dev/testkit';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { storage } from '@/sync/domains/state/storage';
import { upsertServerProfile, setActiveServerId, setServerProfileIdentityForUrl } from '@/sync/domains/server/serverProfiles';
import { serverScopedRpcSocketPool } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcSocketPool';
import { resetScopedSessionDataKeyCacheForTests } from '@/sync/runtime/orchestration/serverScopedRpc/resolveScopedSessionDataKey';
import { useNotificationResponseRouting } from './useNotificationResponseRouting';

const boundary = vi.hoisted(() => ({
    secrets: new Map<string, string>(),
    rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    navigate: vi.fn(),
    listener: null as null | ((response: unknown) => void),
}));

// Native secure storage, Expo response delivery, routing and socket transport are system boundaries.
vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => boundary.secrets.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { boundary.secrets.set(key, value); },
    deleteItemAsync: async (key: string) => { boundary.secrets.delete(key); },
}));
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' });
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { navigate: boundary.navigate, push: vi.fn() } }).module;
});
vi.mock('expo-notifications', () => ({
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    getLastNotificationResponseAsync: async () => null,
    clearLastNotificationResponseAsync: async () => {},
    addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
        boundary.listener = listener;
        return { remove: () => { boundary.listener = null; } };
    },
}));
vi.mock('socket.io-client', () => ({
    io: () => ({
        connected: true,
        on: () => {}, off: () => {}, connect: () => {}, disconnect: () => {}, emit: () => {},
        emitWithAck: (...args: unknown[]) => boundary.rpc(...args),
        timeout: () => ({ emitWithAck: (...args: unknown[]) => boundary.rpc(...args) }),
    }),
}));

const serverUrl = 'https://permission-notifications.example.test';
function token(accountId: string): string {
    return `e30.${btoa(JSON.stringify({ sub: accountId }))}.signature`;
}
function response(identifier: string, data: Record<string, unknown>) {
    return {
        actionIdentifier: PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1,
        notification: { request: { identifier, content: { data: { serverUrl, sessionId: 'session', requestId: 'reused', ...data } } } },
    };
}

describe('foreground notification permission actions', () => {
    beforeEach(async () => {
        Platform.OS = 'ios';
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK', 'false');
        boundary.secrets.clear();
        boundary.rpc.mockReset().mockResolvedValue({ ok: true, result: { ok: true } });
        boundary.navigate.mockClear();
        boundary.listener = null;
        const profile = upsertServerProfile({ serverUrl, name: 'Permission test' });
        setServerProfileIdentityForUrl(serverUrl, 'permission-server');
        setActiveServerId(profile.id, { scope: 'device' });
        expect(await TokenStorage.setCredentials({ token: token('account-b') })).toBe(true);
        storage.setState({ profileScope: { serverId: 'permission-server', accountId: 'account-b' } });
        const session = V2SessionByIdResponseSchema.parse({ session: {
            id: 'session', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
            archivedAt: null, metadata: '{}', metadataVersion: 0, agentState: null, agentStateVersion: 0,
            pendingCount: 0, pendingVersion: 0, encryptionMode: 'plain', dataEncryptionKey: null,
        } });
        vi.stubGlobal('fetch', vi.fn(createServerFetchWithReachabilityProbe(async (input) => {
            const path = getServerFetchUrl(input).pathname;
            if (path === '/v2/sessions/session') return createOkFetchResponse(session);
            if (path === '/v1/account/profile') return createOkFetchResponse(AccountProfileSchema.parse({ id: 'account-b' }));
            if (path === '/v1/artifacts') return createOkFetchResponse([]);
            return new Response('{}', { status: 404 });
        })));
    });
    afterEach(async () => {
        await serverScopedRpcSocketPool.stopAll();
        serverScopedRpcSocketPool.resetForTests();
        resetScopedSessionDataKeyCacheForTests();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('reviews an old action, refuses a different account, then sends only the current occurrence', async () => {
        const hook = await renderHook(() => useNotificationResponseRouting({ enabled: true, refreshAuth: async () => {} }));
        try {
            await vi.waitFor(() => expect(boundary.listener).toEqual(expect.any(Function)));
            await act(async () => { boundary.listener?.(response('old', {})); });
            await vi.waitFor(() => expect(boundary.navigate).toHaveBeenCalledTimes(1));
            expect(boundary.rpc).not.toHaveBeenCalled();

            await act(async () => { boundary.listener?.(response('other-account', { occurrenceId: 'occurrence-a', accountId: 'account-a' })); });
            await vi.waitFor(() => expect(boundary.navigate).toHaveBeenCalledTimes(2));
            expect(boundary.rpc).not.toHaveBeenCalled();

            await act(async () => { boundary.listener?.(response('current', { occurrenceId: 'occurrence-b', accountId: 'account-b' })); });
            await vi.waitFor(() => expect(boundary.navigate).toHaveBeenCalledTimes(3));
            expect(boundary.rpc).toHaveBeenCalledTimes(1);
            expect(boundary.rpc.mock.calls[0]?.[1]).toMatchObject({
                method: 'session:session.permission.respondToOccurrence.v1',
                params: expect.objectContaining({ id: 'reused', occurrenceId: 'occurrence-b', approved: true }),
            });
        } finally {
            await hook.unmount();
        }
    });
});
