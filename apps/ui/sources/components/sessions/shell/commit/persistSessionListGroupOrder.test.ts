import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { useSessionRepositoryView } from '../view-state/useSessionRepositoryView';
import { persistSessionListFolders } from './persistSessionListFolders';
import { storage, readSessionOrganizationFolders } from '@/sync/domains/state/storage';
import { buildSessionOrganizationProjection } from '@/sync/domains/session/organization/projection';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { persistSessionListGroupOrder } from './persistSessionListGroupOrder';

const boundary = vi.hoisted(() => ({ credentials: vi.fn(), reorder: vi.fn(), upsertFolder: vi.fn() }));
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
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({ fetchAccountEncryptionMode: async () => ({ mode: 'plain', updatedAt: 0 }) }));
vi.mock('@/sync/api/session/sessionOrganizationApi', async importOriginal => ({
    ...await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>(), reorderSessionOrganization: boundary.reorder, upsertSessionOrganizationFolder: boundary.upsertFolder,
}));
const credentials = (accountId: string) => ({ token: `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.signature` });
let previous: ReturnType<typeof storage.getState>;
beforeEach(() => {
    previous = storage.getState();
    storage.setState({ profileScope: { serverId: 'home-a', accountId: 'account-a' } });
    storage.getState().clearSessionOrganizationForServer('home-a');
    storage.getState().clearSessionOrganizationForServer('home-b');
    boundary.credentials.mockReset().mockImplementation(async (url: string) => credentials(url.includes('b.example') ? 'account-b' : 'account-a'));
    boundary.upsertFolder.mockReset().mockImplementation(async ({ request }) => ({ folder: { ...request, archivedAt: null, createdAt: 1, updatedAt: 1 } }));
    boundary.reorder.mockReset().mockImplementation(async ({ request }) => ({ orderEntries: request.entries.map((entry: object) => ({ ...entry, scopeKind: request.scopeKind, scopeKey: request.scopeKey })) }));
});
afterEach(() => { standardCleanup(); storage.setState(previous, true); });

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
    it.each(['original', 'repository'] as const)('persists a physical foreign folder order to its Home in %s view', async mode => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'home-b', machineId: 'machine-b', rootPath: '/repo' };
        const folderKey = 'server:home-b:project:repo:folder:foreign-folder';
        const items: SessionListViewItem[] = [
            { type: 'header', headerKind: 'folder', title: 'Foreign folder', folderId: 'foreign-folder',
                groupKey: folderKey, serverId: 'home-b', workspace, depth: 0 },
            ...['first', 'second'].map(id => ({ type: 'session' as const, serverId: 'home-b', workspace,
                folderId: 'foreign-folder', folderDepth: 1, groupKind: 'folder' as const, groupKey: folderKey,
                session: createSessionFixture({ id, serverId: 'home-b', metadata: { machineId: 'machine-b', path: '/repo', host: 'foreign' } as never }),
            })),
        ];
        const hook = await renderHook(() => useSessionRepositoryView({ items, mode, setMode: () => {}, onFailure: () => {}, orderingMode: 'custom' }));
        if (mode === 'repository') await vi.waitFor(() => expect(hook.getCurrent().scopes['home-b']?.accountId).toBe('account-b'));
        await act(async () => { await persistSessionListGroupOrder({
            currentOrder: hook.getCurrent().groupOrder,
            nextOrder: { ...hook.getCurrent().groupOrder, [folderKey]: ['home-b:second', 'home-b:first'] },
            defaultServerId: 'home-a', groupScopes: hook.getCurrent().orderScopes,
        }); });
        expect(boundary.reorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            serverUrl: 'https://b.example.com', credentials: credentials('account-b'),
            request: expect.objectContaining({ scopeKey: folderKey, entries: [
                { itemKind: 'session', itemKey: 'second', sortKey: '00000001' },
                { itemKind: 'session', itemKey: 'first', sortKey: '00000002' },
            ] }),
        }));
        expect(orders('home-b')[folderKey]).toEqual(['home-b:second', 'home-b:first']);
        expect(orders('home-a')).toEqual({});
    });

    it('keeps the owning Home for a hidden order cleared by structural move cleanup', async () => {
        const hiddenKey = 'repository-v1:opaque-hidden-order';
        const record = storage.getState().applySessionOrganizationOrderScopeOptimistic('home-b', {
            scopeKind: 'group', scopeKey: hiddenKey,
            entries: [{ scopeKind: 'group', scopeKey: hiddenKey, itemKind: 'session', itemKey: 'moved', sortKey: '00000001' }],
        });
        storage.getState().commitSessionOrganizationOptimistic(record);
        const items: SessionListViewItem[] = [{ type: 'header', headerKind: 'project', title: 'Visible checkout',
            serverId: 'home-b', groupKey: 'visible-project', workspaceScopeHint: { serverId: 'home-b', machineId: 'machine-b', rootPath: '/repo' } }];
        const hook = await renderHook(() => useSessionRepositoryView({ items, mode: 'original', setMode: () => {}, onFailure: () => {} }));
        expect(hook.getCurrent().groupOrder[hiddenKey]).toEqual(['home-b:moved']);
        await act(async () => { await persistSessionListGroupOrder({
            currentOrder: hook.getCurrent().groupOrder, nextOrder: { ...hook.getCurrent().groupOrder, [hiddenKey]: [] },
            defaultServerId: 'home-a', groupScopes: hook.getCurrent().orderScopes,
        }); });
        expect(boundary.reorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            serverUrl: 'https://b.example.com', request: { scopeKind: 'group', scopeKey: hiddenKey, entries: [] },
        }));
        expect(orders('home-a')).toEqual({});
    });

    it('partitions a shared pinned order by the existing Home owners', async () => {
        await persistSessionListGroupOrder({
            currentOrder: {}, nextOrder: { 'pinned-v1': ['home-b:b2', 'home-a:a', 'home-b:b1'] }, defaultServerId: 'home-a',
            groupScopes: { 'pinned-v1': [{ serverId: 'home-a', accountId: 'account-a' }, { serverId: 'home-b', accountId: 'account-b' }] },
        });
        expect(boundary.reorder).toHaveBeenCalledTimes(2);
        expect(orders('home-a')['pinned-v1']).toEqual(['home-a:a']);
        expect(orders('home-b')['pinned-v1']).toEqual(['home-b:b2', 'home-b:b1']);
    });

    it('writes only the changed repository scope to its owning Home, then reads the actual optimistic/reconciled order', async () => {
        await persistSessionListGroupOrder({
            currentOrder: { original: ['home-a:A'], repository: ['home-b:B', 'home-b:A'] },
            nextOrder: { original: ['home-a:A'], repository: ['home-b:A', 'home-b:B'] },
            defaultServerId: 'home-a', groupScopes: { repository: [{ serverId: 'home-b', accountId: 'account-b' }] },
        });
        expect(boundary.reorder).toHaveBeenCalledTimes(1);
        expect(boundary.reorder.mock.calls[0][0]).toMatchObject({ serverUrl: 'https://b.example.com', credentials: credentials('account-b') });
        expect(orders('home-b').repository).toEqual(['home-b:A', 'home-b:B']);
        expect(orders('home-a')).toEqual({});
    });

    it('rejects a changed account before issuing the reorder or optimistic write', async () => {
        boundary.credentials.mockResolvedValue(credentials('replacement-account'));
        await expect(persistSessionListGroupOrder({ currentOrder: {}, nextOrder: { repository: ['home-b:A'] },
            defaultServerId: 'home-a', groupScopes: { repository: [{ serverId: 'home-b', accountId: 'account-b' }] },
        })).rejects.toThrow();
        expect(boundary.reorder).not.toHaveBeenCalled();
        expect(orders('home-b')).toEqual({});
    });
});


describe('session list folder persistence', () => {
    it('creates a physical folder in the chosen foreign Home and rolls back a failed write without touching the active Home', async () => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'home-b', machineId: 'machine-b', rootPath: '/checkout-b' };
        const folder = { id: 'folder-b', name: 'Chosen folder', workspace, parentId: null, createdAt: 1, updatedAt: 1 };
        const input = { current: { v: 1 as const, folders: [] }, next: { v: 1 as const, folders: [folder] },
            serverId: 'home-a', scope: { serverId: 'home-b', accountId: 'account-b' } };
        await persistSessionListFolders(input);
        expect(boundary.upsertFolder.mock.calls[0][0]).toMatchObject({ serverUrl: 'https://b.example.com', credentials: credentials('account-b'), request: { display: { t: 'plain', v: { workspace } } } });
        expect(readSessionOrganizationFolders('home-b').folders).toEqual([folder]);
        expect(readSessionOrganizationFolders('home-a').folders).toEqual([]);
        boundary.upsertFolder.mockRejectedValueOnce(new Error('offline'));
        await expect(persistSessionListFolders({ ...input, current: input.next, next: { v: 1, folders: [{ ...folder, name: 'Unconfirmed' }] } })).rejects.toThrow('offline');
        expect(readSessionOrganizationFolders('home-b').folders[0].name).toBe('Chosen folder');
    });
});
