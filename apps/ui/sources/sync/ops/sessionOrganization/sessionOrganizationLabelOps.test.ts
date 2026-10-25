import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { setServerProfileIdentityForUrl, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`, secret: 'secret-a' };
const serverId = 'srv_label_ops';
const serverUrl = 'https://server-a.example';

const apiMocks = vi.hoisted(() => ({
    fetchAccountEncryptionMode: vi.fn(),
    deleteSessionOrganizationLabel: vi.fn(),
    upsertSessionOrganizationLabel: vi.fn(),
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: apiMocks.fetchAccountEncryptionMode,
}));

vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>();
    return {
        ...actual,
        deleteSessionOrganizationLabel: apiMocks.deleteSessionOrganizationLabel,
        upsertSessionOrganizationLabel: apiMocks.upsertSessionOrganizationLabel,
    };
});

describe('session organization label ops', () => {
    beforeEach(async () => {
        upsertServerProfile({ serverUrl });
        setServerProfileIdentityForUrl(serverUrl, serverId);
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
        apiMocks.deleteSessionOrganizationLabel.mockReset();
        apiMocks.fetchAccountEncryptionMode.mockReset();
        apiMocks.fetchAccountEncryptionMode.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
        apiMocks.upsertSessionOrganizationLabel.mockReset();
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().getState().clearSessionOrganizationForServer(serverId);
    });
    afterEach(() => vi.restoreAllMocks());

    it('upserts and deletes workspace labels through the ops barrel', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { deleteSessionLabel, upsertSessionLabel } = await import('./index');

        apiMocks.upsertSessionOrganizationLabel.mockResolvedValueOnce({
            label: {
                labelKind: 'workspace',
                scopeKey: 'wl_project_a',
                display: { t: 'plain', v: { label: 'Project A' } },
                archivedAt: null,
                createdAt: 10,
                updatedAt: 11,
            },
        });

        await upsertSessionLabel({
            credentials,
            serverId,
            serverUrl,
            request: {
                labelKind: 'workspace',
                scopeKey: 'wl_project_a',
                display: { t: 'plain', v: { label: 'Project A' } },
            },
        });

        expect(getStorage().getState().sessionOrganizationLabelsByLabelKey[`${serverId}:workspace:wl_project_a`]?.display).toEqual({
            t: 'plain',
            v: { label: 'Project A' },
        });
        expect(apiMocks.upsertSessionOrganizationLabel).toHaveBeenCalledWith(expect.objectContaining({
            request: expect.objectContaining({
                display: { t: 'plain', v: { label: 'Project A' } },
            }),
        }));

        apiMocks.deleteSessionOrganizationLabel.mockResolvedValueOnce({
            labelKind: 'workspace',
            scopeKey: 'wl_project_a',
            archived: true,
        });

        await deleteSessionLabel({
            credentials,
            serverId,
            serverUrl,
            request: {
                labelKind: 'workspace',
                scopeKey: 'wl_project_a',
            },
        });

        expect(getStorage().getState().sessionOrganizationLabelsByLabelKey[`${serverId}:workspace:wl_project_a`]).toBeUndefined();
    });
});
