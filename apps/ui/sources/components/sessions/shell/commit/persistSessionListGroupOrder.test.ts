import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { buildSessionOrganizationProjection } from '@/sync/domains/session/organization/projection';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { persistSessionListGroupOrder } from './persistSessionListGroupOrder';

const boundary = vi.hoisted(() => ({ credentials: vi.fn(), reorder: vi.fn() }));
vi.mock('@/auth/storage/tokenStorage', async importOriginal => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return { ...actual, TokenStorage: { ...actual.TokenStorage, getCredentialsForServerUrl: boundary.credentials } };
});
vi.mock('@/sync/domains/server/serverProfiles', async importOriginal => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createServerProfilesModuleMock({ importOriginal, overrides: { listServerProfiles: () => [
        { id: 'profile-a', serverIdentityId: 'home-a', serverUrl: 'https://a.example.com' },
        { id: 'profile-b', serverIdentityId: 'home-b', serverUrl: 'https://b.example.com' },
    ] as any } });
});
vi.mock('@/sync/api/session/sessionOrganizationApi', async importOriginal => ({
    ...await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>(), reorderSessionOrganization: boundary.reorder,
}));
const credentials = (accountId: string) => ({ token: `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.signature`, secret: 'secret' });
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' } });
    storage.getState().clearSessionOrganizationForServer('home-a');
    storage.getState().clearSessionOrganizationForServer('home-b');
    boundary.credentials.mockReset().mockImplementation(async (url: string) => credentials(url.includes('b.example') ? 'account-b' : 'account-a'));
    boundary.reorder.mockReset().mockImplementation(async ({ request }) => ({ orderEntries: request.entries.map((entry: object) => ({ ...entry, scopeKind: request.scopeKind, scopeKey: request.scopeKey })) }));
});
afterEach(() => storage.setState(previous, true));

function orders(serverId: string) {
    const state = storage.getState();
    const projection = buildSessionOrganizationProjection({
        schemaVersionByServerId: state.sessionOrganizationSchemaVersionByServerId,
        snapshotVersionByServerId: state.sessionOrganizationSnapshotVersionByServerId,
        pinsBySessionKey: state.sessionOrganizationPinsBySessionKey,
        foldersByFolderKey: state.sessionOrganizationFoldersByFolderKey,
        folderAssignmentsBySessionKey: state.sessionOrganizationFolderAssignmentsBySessionKey,
        tagsByTagKey: state.sessionOrganizationTagsByTagKey,
        tagAssignmentsBySessionKey: state.sessionOrganizationTagAssignmentsBySessionKey,
        attentionStandingsBySessionKey: state.sessionOrganizationAttentionStandingsBySessionKey,
        orderEntriesByScopeKey: state.sessionOrganizationOrderEntriesByScopeKey,
        labelsByLabelKey: state.sessionOrganizationLabelsByLabelKey,
    }, serverId);
    return buildSessionOrganizationListViewState({ serverId, projection }).sessionListGroupOrderV1;
}

describe('session list group order persistence', () => {
    it('writes only the changed repository scope to its owning Home, then reads the actual optimistic/reconciled order', async () => {
        await persistSessionListGroupOrder({
            currentOrder: { original: ['home-a:A'], repository: ['home-b:B', 'home-b:A'] },
            nextOrder: { original: ['home-a:A'], repository: ['home-b:A', 'home-b:B'] },
            defaultServerId: 'home-a', repositoryScopes: { repository: { serverId: 'home-b', accountId: 'account-b' } },
        });
        expect(boundary.reorder).toHaveBeenCalledTimes(1);
        expect(boundary.reorder.mock.calls[0][0]).toMatchObject({ serverUrl: 'https://b.example.com', credentials: credentials('account-b') });
        expect(orders('home-b').repository).toEqual(['home-b:A', 'home-b:B']);
        expect(orders('home-a')).toEqual({});
    });

    it('rejects a changed account before issuing the reorder or optimistic write', async () => {
        boundary.credentials.mockResolvedValue(credentials('replacement-account'));
        await expect(persistSessionListGroupOrder({ currentOrder: {}, nextOrder: { repository: ['home-b:A'] },
            defaultServerId: 'home-a', repositoryScopes: { repository: { serverId: 'home-b', accountId: 'account-b' } },
        })).rejects.toThrow();
        expect(boundary.reorder).not.toHaveBeenCalled();
        expect(orders('home-b')).toEqual({});
    });
});
