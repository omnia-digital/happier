import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HappyError } from '@/utils/errors/errors';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

const apiMocks = vi.hoisted(() => ({
    fetchAccountEncryptionMode: vi.fn(),
    setSessionPin: vi.fn(),
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: apiMocks.fetchAccountEncryptionMode,
}));

vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>();
    return {
        ...actual,
        setSessionPin: apiMocks.setSessionPin,
    };
});

describe('setSessionPin op', () => {
    const serverUrl = 'https://pin-limit.example.test';
    const credentials = { token: `e30.${btoa(JSON.stringify({ sub: 'account-a' }))}.signature`, secret: 'secret-a' };
    beforeEach(async () => {
        apiMocks.fetchAccountEncryptionMode.mockReset();
        apiMocks.fetchAccountEncryptionMode.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
        apiMocks.setSessionPin.mockReset();
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const profile = upsertServerProfile({ serverUrl });
        setActiveServerId(profile.id, { scope: 'device' });
        getStorage().setState({ profileScope: { serverId: profile.id, accountId: 'account-a' } });
        getStorage().getState().clearSessionOrganizationForServer(profile.id);
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    });
    afterEach(() => vi.restoreAllMocks());

    it('rolls back a rejected pin and turns the server limit code into recovery guidance', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { setSessionPin } = await import('./setSessionPin');
        const serverId = upsertServerProfile({ serverUrl }).id;
        apiMocks.setSessionPin.mockRejectedValueOnce(new HappyError('session-pin-limit-exceeded', false));

        await expect(setSessionPin({
            credentials,
            serverId,
            serverUrl,
            sessionId: 's1001',
            pinned: true,
        })).rejects.toThrow('You can pin up to 1,000 sessions. Unpin another session and try again.');

        const state = getStorage().getState();
        expect(state.sessionOrganizationPinsBySessionKey[`${serverId}:s1001`]).toBeUndefined();
        expect(state.sessionOrganizationOptimisticRecords).toEqual({});
    });
});
