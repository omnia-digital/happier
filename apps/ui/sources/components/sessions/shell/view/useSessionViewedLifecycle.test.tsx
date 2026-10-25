import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import {
    clearActiveViewingSessionsForServerScopeReset,
    getActiveViewingSessionId,
    isSessionVisible,
} from '@/sync/domains/session/activeViewingSession';
import { resetSessionManualUnreadHoldsForTests } from '@/sync/domains/session/readState/sessionManualUnreadHold';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { getStorage } from '@/sync/domains/state/storageStore';

import { useSessionViewedLifecycle } from './useSessionViewedLifecycle';

const apiMocks = vi.hoisted(() => ({ setSessionAttentionStanding: vi.fn() }));
// The HTTP adapter is the system boundary; the lifecycle, mutation owner, and store stay real.
vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>(),
    setSessionAttentionStanding: apiMocks.setSessionAttentionStanding,
}));

type ScopedViewedLifecycleInput = Parameters<typeof useSessionViewedLifecycle>[0] & Readonly<{
    serverId?: string | null;
}>;

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (effect: () => void | (() => void)) => {
        React.useEffect(() => {
            const cleanup = effect();
            return () => {
                cleanup?.();
            };
        }, [effect]);
    },
}));

describe('useSessionViewedLifecycle', () => {
    beforeEach(() => {
        resetSessionManualUnreadHoldsForTests();
        clearActiveViewingSessionsForServerScopeReset();
        apiMocks.setSessionAttentionStanding.mockReset();
    });

    afterEach(() => {
        standardCleanup();
        vi.restoreAllMocks();
        clearActiveViewingSessionsForServerScopeReset();
    });

    it('tracks focused viewing activation without owning surface visibility', async () => {
        const hook = await renderHook((input: ScopedViewedLifecycleInput) => {
            useSessionViewedLifecycle(input);
            return null;
        }, {
            initialProps: {
                sessionId: 'shared-session',
                serverId: 'server-a',
                surfaceFocused: true,
                visibleReadSeq: null,
            } satisfies ScopedViewedLifecycleInput,
        });

        expect(getActiveViewingSessionId()).toBe('shared-session');
        expect(isSessionVisible('shared-session', 'server-a')).toBe(false);

        await hook.unmount();

        expect(getActiveViewingSessionId()).toBeNull();
        expect(isSessionVisible('shared-session', 'server-a')).toBe(false);
    });

    it('clears a due reminder on focused opening even without a transcript read cursor', async () => {
        const profile = upsertServerProfile({ serverUrl: 'https://reminder-lifecycle.example' });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({
            token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`,
            secret: 'secret',
        });
        const store = getStorage();
        const recordId = store.getState().setSessionAttentionStandingOptimistic(profile.id, 'reminded-session', {
            sessionId: 'reminded-session', standing: true, remindAt: 1, updatedAt: 1,
        });
        store.getState().commitSessionOrganizationOptimistic(recordId);
        apiMocks.setSessionAttentionStanding.mockResolvedValue({
            standing: { sessionId: 'reminded-session', standing: true, updatedAt: 2 },
        });

        const hook = await renderHook((input: ScopedViewedLifecycleInput) => useSessionViewedLifecycle(input), {
            initialProps: {
                sessionId: 'reminded-session', serverId: profile.id, surfaceFocused: false, visibleReadSeq: null,
            },
        });
        expect(store.getState().sessionOrganizationAttentionStandingsBySessionKey[`${profile.id}:reminded-session`]?.remindAt).toBe(1);
        await hook.rerender({
            sessionId: 'reminded-session', serverId: profile.id, surfaceFocused: true, visibleReadSeq: null,
        });
        await vi.waitFor(() => {
            expect(store.getState().sessionOrganizationAttentionStandingsBySessionKey[`${profile.id}:reminded-session`])
                .toEqual({ sessionId: 'reminded-session', standing: true, updatedAt: 2 });
        });
        await hook.unmount();
        expect(apiMocks.setSessionAttentionStanding).toHaveBeenCalledTimes(1);
        store.getState().clearSessionOrganizationForServer(profile.id);
    });
});
