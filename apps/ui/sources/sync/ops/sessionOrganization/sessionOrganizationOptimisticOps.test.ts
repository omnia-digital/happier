import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    fetchAccountEncryptionMode: vi.fn(),
    moveSessionFolderAssignments: vi.fn(),
    randomUUID: vi.fn(),
    upsertSessionOrganizationFolder: vi.fn(),
    upsertSessionOrganizationTag: vi.fn(),
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: apiMocks.fetchAccountEncryptionMode,
}));

vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>();
    return {
        ...actual,
        moveSessionFolderAssignments: apiMocks.moveSessionFolderAssignments,
        upsertSessionOrganizationFolder: apiMocks.upsertSessionOrganizationFolder,
        upsertSessionOrganizationTag: apiMocks.upsertSessionOrganizationTag,
    };
});

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: apiMocks.randomUUID,
}));

type Deferred<T> = {
    promise: Promise<T>;
    reject: (error: unknown) => void;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let reject!: (error: unknown) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, reject, resolve };
}

vi.mock('@/auth/storage/tokenStorage', async (original) => {
    const actual = await original<typeof import('@/auth/storage/tokenStorage')>();
    return { ...actual, TokenStorage: { ...actual.TokenStorage, getCredentialsForServerUrl: async () => credentials } };
});
vi.mock('@/sync/domains/server/serverProfiles', async (original) => ({
    ...await original<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: () => ({ id: 'server-a', serverUrl: 'https://server-a.test' }),
}));

const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`, secret: 'secret-a' };

describe('session organization optimistic ops', () => {
    beforeEach(async () => {
        apiMocks.fetchAccountEncryptionMode.mockReset();
        apiMocks.fetchAccountEncryptionMode.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
        apiMocks.moveSessionFolderAssignments.mockReset();
        apiMocks.randomUUID.mockReset();
        apiMocks.randomUUID.mockReturnValue('11111111-2222-4333-8444-555555555555');
        apiMocks.upsertSessionOrganizationFolder.mockReset();
        apiMocks.upsertSessionOrganizationTag.mockReset();

        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
        getStorage().getState().clearSessionOrganizationForServer('server-a');
    });

    it('allocates a stable folder id before optimistic create requests that omit one', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { upsertSessionFolder } = await import('./upsertSessionFolder');
        const pending = createDeferred<Awaited<ReturnType<typeof apiMocks.upsertSessionOrganizationFolder>>>();
        apiMocks.upsertSessionOrganizationFolder.mockReturnValueOnce(pending.promise);

        const promise = upsertSessionFolder({
            credentials,
            serverId: 'server-a',
            request: {
                folderKey: 'folder-created',
                parentFolderId: null,
                parentFolderKey: null,
                sortKey: '00000001',
                display: { t: 'plain', v: { name: 'Created', workspace: { t: 'workspaceScope', serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' } } },
            },
        }).catch(() => undefined);

        await vi.waitFor(() => expect(apiMocks.upsertSessionOrganizationFolder).toHaveBeenCalledTimes(1));
        const folderId = 'folder_11111111222243338444555555555555';
        expect(apiMocks.upsertSessionOrganizationFolder.mock.calls[0]?.[0].request.folderId).toBe(folderId);
        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey[`server-a:${folderId}`]).toEqual(expect.objectContaining({
            folderId,
            folderKey: 'folder-created',
        }));

        pending.reject(new Error('folder write failed'));
        await promise;
    });

    it('optimistically upserts a folder and rolls it back when the request fails', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { upsertSessionFolder } = await import('./upsertSessionFolder');
        const pending = createDeferred<Awaited<ReturnType<typeof apiMocks.upsertSessionOrganizationFolder>>>();
        apiMocks.upsertSessionOrganizationFolder.mockReturnValueOnce(pending.promise);

        const promise = upsertSessionFolder({
            credentials,
            serverId: 'server-a',
            request: {
                folderId: 'folder-a',
                folderKey: 'folder-a',
                parentFolderId: null,
                parentFolderKey: null,
                sortKey: '00000001',
                display: { t: 'plain', v: { name: 'Planning', workspace: { t: 'workspaceScope', serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' } } },
            },
        }).catch(() => undefined);

        await vi.waitFor(() => expect(apiMocks.upsertSessionOrganizationFolder).toHaveBeenCalledTimes(1));
        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey['server-a:folder-a']).toEqual(expect.objectContaining({
            folderId: 'folder-a',
            display: { t: 'plain', v: { name: 'Planning', workspace: { t: 'workspaceScope', serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' } } },
        }));

        pending.reject(new Error('folder write failed'));
        await promise;

        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey['server-a:folder-a']).toBeUndefined();
    });

    it('optimistically upserts a tag and rolls it back when the request fails', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { upsertSessionTag } = await import('./upsertSessionTag');
        const pending = createDeferred<Awaited<ReturnType<typeof apiMocks.upsertSessionOrganizationTag>>>();
        apiMocks.upsertSessionOrganizationTag.mockReturnValueOnce(pending.promise);

        const promise = upsertSessionTag({
            credentials,
            serverId: 'server-a',
            request: {
                tagId: 'tag-a',
                tagKey: 'tag-a',
                sortKey: '00000001',
                display: { t: 'plain', v: { label: 'Urgent' } },
            },
        }).catch(() => undefined);

        await vi.waitFor(() => expect(apiMocks.upsertSessionOrganizationTag).toHaveBeenCalledTimes(1));
        expect(getStorage().getState().sessionOrganizationTagsByTagKey['server-a:tag-a']).toEqual(expect.objectContaining({
            tagId: 'tag-a',
            display: { t: 'plain', v: { label: 'Urgent' } },
        }));

        pending.reject(new Error('tag write failed'));
        await promise;

        expect(getStorage().getState().sessionOrganizationTagsByTagKey['server-a:tag-a']).toBeUndefined();
    });

    it('allocates a stable tag id before optimistic create requests that omit one', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { upsertSessionTag } = await import('./upsertSessionTag');
        const pending = createDeferred<Awaited<ReturnType<typeof apiMocks.upsertSessionOrganizationTag>>>();
        apiMocks.upsertSessionOrganizationTag.mockReturnValueOnce(pending.promise);

        const promise = upsertSessionTag({
            credentials,
            serverId: 'server-a',
            request: {
                tagKey: 'tag-created',
                sortKey: '00000001',
                display: { t: 'plain', v: { label: 'Created' } },
            },
        }).catch(() => undefined);

        await vi.waitFor(() => expect(apiMocks.upsertSessionOrganizationTag).toHaveBeenCalledTimes(1));
        const tagId = 'tag_11111111222243338444555555555555';
        expect(apiMocks.upsertSessionOrganizationTag.mock.calls[0]?.[0].request.tagId).toBe(tagId);
        expect(getStorage().getState().sessionOrganizationTagsByTagKey[`server-a:${tagId}`]).toEqual(expect.objectContaining({
            tagId,
            tagKey: 'tag-created',
        }));

        pending.reject(new Error('tag write failed'));
        await promise;
    });

    it('optimistically moves scoped folder assignments and rolls them back when the request fails', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { moveSessionFolderAssignments } = await import('./moveSessionFolderAssignments');
        const pending = createDeferred<Awaited<ReturnType<typeof apiMocks.moveSessionFolderAssignments>>>();
        apiMocks.moveSessionFolderAssignments.mockReturnValueOnce(pending.promise);
        getStorage().getState().applySessionFolderAssignments('server-a', [
            { sessionId: 's1', folderId: 'folder-a' },
            { sessionId: 's2', folderId: 'folder-b' },
            { sessionId: 's3', folderId: 'folder-c' },
        ]);

        const promise = moveSessionFolderAssignments({
            credentials,
            serverId: 'server-a',
            fromFolderIds: ['folder-a', 'folder-b'],
            toFolderId: 'folder-target',
        }).catch(() => undefined);

        await vi.waitFor(() => expect(apiMocks.moveSessionFolderAssignments).toHaveBeenCalledTimes(1));
        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': 'folder-target',
            'server-a:s2': 'folder-target',
            'server-a:s3': 'folder-c',
        });

        pending.reject(new Error('bulk move failed'));
        await promise;

        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': 'folder-a',
            'server-a:s2': 'folder-b',
            'server-a:s3': 'folder-c',
        });
    });
});
