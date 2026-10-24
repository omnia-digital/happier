import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createEncryptionFromAuthCredentials: vi.fn(),
    fetchAccountEncryptionMode: vi.fn(),
    upsertSessionOrganizationFolder: vi.fn(),
    upsertSessionOrganizationLabel: vi.fn(),
    upsertSessionOrganizationTag: vi.fn(),
    fetchSessionOrganizationSnapshot: vi.fn(),
    setSessionTagAssignments: vi.fn(),
    randomUUID: vi.fn(),
}));

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: mocks.createEncryptionFromAuthCredentials,
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: mocks.fetchAccountEncryptionMode,
}));

vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>();
    return {
        ...actual,
        upsertSessionOrganizationFolder: mocks.upsertSessionOrganizationFolder,
        upsertSessionOrganizationLabel: mocks.upsertSessionOrganizationLabel,
        upsertSessionOrganizationTag: mocks.upsertSessionOrganizationTag,
        fetchSessionOrganizationSnapshot: mocks.fetchSessionOrganizationSnapshot,
        setSessionTagAssignments: mocks.setSessionTagAssignments,
    };
});

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: mocks.randomUUID,
}));

vi.mock('@/auth/storage/tokenStorage', async (original) => {
    const actual = await original<typeof import('@/auth/storage/tokenStorage')>();
    return { ...actual, TokenStorage: { ...actual.TokenStorage, getCredentialsForServerUrl: async () => credentials } };
});
vi.mock('@/sync/domains/server/serverProfiles', async (original) => ({
    ...await original<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: () => ({ id: 'server-a', serverUrl: 'https://server-a.test' }),
}));

const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`, secret: 'secret-a' };
const machineKey = new Uint8Array(32).fill(8);

describe('session organization display write ops', () => {
    beforeEach(async () => {
        mocks.createEncryptionFromAuthCredentials.mockReset();
        mocks.createEncryptionFromAuthCredentials.mockResolvedValue({
            getContentPrivateKey: () => machineKey,
        });
        mocks.fetchAccountEncryptionMode.mockReset();
        mocks.fetchAccountEncryptionMode.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
        mocks.upsertSessionOrganizationFolder.mockReset();
        mocks.upsertSessionOrganizationLabel.mockReset();
        mocks.upsertSessionOrganizationTag.mockReset();
        mocks.fetchSessionOrganizationSnapshot.mockReset();
        mocks.setSessionTagAssignments.mockReset();
        mocks.randomUUID.mockReset();
        mocks.randomUUID.mockReturnValue('11111111-2222-4333-8444-555555555555');
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
        getStorage().getState().clearSessionOrganizationForServer('server-a');
    });

    it('sends encrypted display envelopes for e2ee folder, tag, and label writes', async () => {
        const {
            upsertSessionFolder,
            upsertSessionLabel,
            upsertSessionTag,
        } = await import('./index');

        mocks.upsertSessionOrganizationFolder.mockResolvedValueOnce({
            folder: {
                folderId: 'folder-a',
                folderKey: 'folder-a',
                parentFolderId: null,
                parentFolderKey: null,
                sortKey: null,
                display: { t: 'plain', v: { name: 'Inbox', workspace: { t: 'workspaceScope', serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' } } },
                archivedAt: null,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        mocks.upsertSessionOrganizationTag.mockResolvedValueOnce({
            tag: {
                tagId: 'tag-a',
                tagKey: 'tag-a',
                sortKey: null,
                display: { t: 'plain', v: { label: 'urgent' } },
                archivedAt: null,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        mocks.upsertSessionOrganizationLabel.mockResolvedValueOnce({
            label: {
                labelKind: 'workspace',
                scopeKey: 'server:server-a',
                display: { t: 'plain', v: { label: 'Project A' } },
                archivedAt: null,
                createdAt: 1,
                updatedAt: 1,
            },
        });

        await upsertSessionFolder({
            credentials,
            serverId: 'server-a',
            request: {
                folderId: 'folder-a',
                folderKey: 'folder-a',
                parentFolderId: null,
                parentFolderKey: null,
                sortKey: null,
                display: { t: 'plain', v: { name: 'Inbox', workspace: { t: 'workspaceScope', serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' } } },
            },
        });
        await upsertSessionTag({
            credentials,
            serverId: 'server-a',
            request: {
                tagId: 'tag-a',
                tagKey: 'tag-a',
                sortKey: null,
                display: { t: 'plain', v: { label: 'urgent' } },
            },
        });
        await upsertSessionLabel({
            credentials,
            serverId: 'server-a',
            request: {
                labelKind: 'workspace',
                scopeKey: 'server:server-a',
                display: { t: 'plain', v: { label: 'Project A' } },
            },
        });

        expect(mocks.upsertSessionOrganizationFolder.mock.calls[0]?.[0].request.display).toMatchObject({ t: 'encrypted' });
        expect(mocks.upsertSessionOrganizationTag.mock.calls[0]?.[0].request.display).toMatchObject({ t: 'encrypted' });
        expect(mocks.upsertSessionOrganizationLabel.mock.calls[0]?.[0].request.display).toMatchObject({ t: 'encrypted' });
        expect(mocks.upsertSessionOrganizationFolder.mock.calls[0]?.[0].request.display).not.toHaveProperty('v');
        expect(mocks.upsertSessionOrganizationTag.mock.calls[0]?.[0].request.display).not.toHaveProperty('v');
        expect(mocks.upsertSessionOrganizationLabel.mock.calls[0]?.[0].request.display).not.toHaveProperty('v');
    });

    it('resolves user-facing tag labels to existing or newly-created server tag ids before assignment', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const {
            setSessionTagLabels,
        } = await import('./index');

        getStorage().getState().applySessionOrganizationSnapshot('server-a', {
            schemaVersion: 1,
            version: 1,
            pins: [],
            folders: [],
            folderAssignments: [],
            tags: [{
                tagId: 'tag-existing',
                tagKey: 'opaque-existing',
                sortKey: null,
                display: { t: 'plain', v: { label: 'Existing' } },
                archivedAt: null,
                createdAt: 1,
                updatedAt: 1,
            }],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
        }, { includeTags: true });
        mocks.upsertSessionOrganizationTag.mockResolvedValueOnce({
            tag: {
                tagId: 'tag_11111111222243338444555555555555',
                tagKey: 'tag_11111111222243338444555555555555',
                sortKey: null,
                display: { t: 'plain', v: { label: 'New' } },
                archivedAt: null,
                createdAt: 2,
                updatedAt: 2,
            },
        });
        mocks.fetchSessionOrganizationSnapshot.mockResolvedValueOnce({
            snapshot: {
                schemaVersion: 1,
                version: 2,
                pins: [],
                folders: [],
                folderAssignments: [],
                tags: [{
                    tagId: 'tag-existing',
                    tagKey: 'opaque-existing',
                    sortKey: null,
                    display: { t: 'plain', v: { label: 'Existing' } },
                    archivedAt: null,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                tagAssignments: [],
                orderEntries: [],
                labels: [],
            },
        });
        mocks.setSessionTagAssignments.mockResolvedValueOnce({
            sessionId: 's1',
            tagIds: ['tag-existing', 'tag_11111111222243338444555555555555'],
        });

        await setSessionTagLabels({
            credentials,
            serverId: 'server-a',
            sessionId: 's1',
            tags: ['Existing', 'New'],
        });

        expect(mocks.upsertSessionOrganizationTag).toHaveBeenCalledTimes(1);
        expect(mocks.upsertSessionOrganizationTag.mock.calls[0]?.[0].request).toEqual(expect.objectContaining({
            tagId: 'tag_11111111222243338444555555555555',
            tagKey: 'tag_11111111222243338444555555555555',
            display: expect.objectContaining({ t: 'encrypted' }),
        }));
        expect(mocks.setSessionTagAssignments).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            request: { tagIds: ['tag-existing', 'tag_11111111222243338444555555555555'] },
        }));
    });

    it('refreshes tag definitions before creating replacements for labels missing from local state', async () => {
        const {
            setSessionTagLabels,
        } = await import('./index');

        mocks.fetchSessionOrganizationSnapshot.mockResolvedValueOnce({
            snapshot: {
                schemaVersion: 1,
                version: 3,
                pins: [],
                folders: [],
                folderAssignments: [],
                tags: [{
                    tagId: 'tag-existing',
                    tagKey: 'opaque-existing',
                    sortKey: null,
                    display: { t: 'plain', v: { label: 'Existing' } },
                    archivedAt: null,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                tagAssignments: [],
                orderEntries: [],
                labels: [],
            },
        });
        mocks.setSessionTagAssignments.mockResolvedValueOnce({
            sessionId: 's1',
            tagIds: ['tag-existing'],
        });

        await setSessionTagLabels({
            credentials,
            serverId: 'server-a',
            sessionId: 's1',
            tags: ['Existing'],
        });

        expect(mocks.fetchSessionOrganizationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                includeFolders: false,
                includeTags: true,
                includeLabels: false,
            },
        }));
        expect(mocks.upsertSessionOrganizationTag).not.toHaveBeenCalled();
        expect(mocks.setSessionTagAssignments).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            request: { tagIds: ['tag-existing'] },
        }));
    });
});
