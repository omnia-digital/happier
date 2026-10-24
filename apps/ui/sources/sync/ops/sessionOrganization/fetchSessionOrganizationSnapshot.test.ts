import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { setServerProfileIdentityForUrl, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

const mocks = vi.hoisted(() => ({
    createEncryptionFromAuthCredentials: vi.fn(),
    fetchAccountEncryptionMode: vi.fn(),
    serverFetch: vi.fn(),
}));

const SERVER_URL = 'https://server-a.example';
const SERVER_ID = 'srv_snapshot_a';
const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`, secret: 'secret-a' };

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: mocks.createEncryptionFromAuthCredentials,
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: mocks.fetchAccountEncryptionMode,
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: mocks.serverFetch,
}));

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('fetchAndApplySessionOrganizationSnapshot', () => {
    beforeEach(async () => {
        upsertServerProfile({ serverUrl: SERVER_URL });
        setServerProfileIdentityForUrl(SERVER_URL, SERVER_ID);
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
        mocks.createEncryptionFromAuthCredentials.mockReset();
        mocks.createEncryptionFromAuthCredentials.mockResolvedValue({
            getContentPrivateKey: () => new Uint8Array(32).fill(9),
        });
        mocks.fetchAccountEncryptionMode.mockReset();
        mocks.fetchAccountEncryptionMode.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
        mocks.serverFetch.mockReset();
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().getState().clearSessionOrganizationForServer(SERVER_ID);
    });
    afterEach(() => vi.restoreAllMocks());

    it('applies scoped snapshot data and marks missing requested assignments as unassigned', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionOrganizationSnapshot } = await import('./fetchSessionOrganizationSnapshot');
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse({
            snapshot: {
                schemaVersion: 1,
                version: 42,
                pins: [{ sessionId: 's1', sortKey: 'rank-a', pinnedAt: 10 }],
                folders: [],
                folderAssignments: [{ sessionId: 's1', folderId: 'folder-a' }],
                tags: [],
                tagAssignments: [{ sessionId: 's1', tagIds: ['tag-a'] }],
                orderEntries: [],
                labels: [],
            },
        }));

        const applied = await fetchAndApplySessionOrganizationSnapshot({
            credentials,
            serverId: SERVER_ID,
            request: {
                includeFolders: false,
                includeTags: false,
                includeLabels: false,
                assignmentSessionIds: ['s1', 's2'],
            },
        });

        expect(applied).toBe(true);
        const state = getStorage().getState();
        expect(state.sessionOrganizationPinsBySessionKey[`${SERVER_ID}:s1`]?.sortKey).toBe('rank-a');
        expect(state.sessionFolderAssignmentsBySessionKey).toMatchObject({
            [`${SERVER_ID}:s1`]: 'folder-a',
            [`${SERVER_ID}:s2`]: null,
        });
        expect(state.sessionOrganizationTagAssignmentsBySessionKey).toMatchObject({
            [`${SERVER_ID}:s1`]: ['tag-a'],
            [`${SERVER_ID}:s2`]: [],
        });
        expect(state.sessionOrganizationLoadingByServerId[SERVER_ID]).toBe(false);
    });

    it('opens encrypted display envelopes before applying snapshots', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { prepareSessionOrganizationDisplayEnvelope } = await import('./sessionOrganizationDisplayEnvelope');
        const { fetchAndApplySessionOrganizationSnapshot } = await import('./fetchSessionOrganizationSnapshot');
        const display = await prepareSessionOrganizationDisplayEnvelope({
            credentials,
            value: {
                name: 'Encrypted folder',
                workspace: { t: 'workspaceScope', serverId: SERVER_ID, machineId: 'machine-a', rootPath: '/repo' },
            },
        });
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse({
            snapshot: {
                schemaVersion: 1,
                version: 43,
                pins: [],
                folders: [{
                    folderId: 'folder-a',
                    folderKey: 'folder-a',
                    parentFolderId: null,
                    parentFolderKey: null,
                    sortKey: null,
                    display,
                    archivedAt: null,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                folderAssignments: [],
                tags: [],
                tagAssignments: [],
                orderEntries: [],
                labels: [],
            },
        }));

        await fetchAndApplySessionOrganizationSnapshot({
            credentials,
            serverId: SERVER_ID,
            request: {
                includeFolders: true,
            },
        });

        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey[`${SERVER_ID}:folder-a`]?.display).toEqual({
            t: 'plain',
            v: {
                name: 'Encrypted folder',
                workspace: { t: 'workspaceScope', serverId: SERVER_ID, machineId: 'machine-a', rootPath: '/repo' },
            },
        });
    });

    it('applies an in-flight snapshot under the current profile scope after server identity discovery', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionOrganizationSnapshot } = await import('./fetchSessionOrganizationSnapshot');
        setServerProfileIdentityForUrl(SERVER_URL, null);
        const localProfileId = upsertServerProfile({ serverUrl: SERVER_URL }).id;
        mocks.serverFetch.mockImplementationOnce(async () => {
            setServerProfileIdentityForUrl(SERVER_URL, SERVER_ID);
            return jsonResponse({
                snapshot: {
                    schemaVersion: 1,
                    version: 44,
                    pins: [],
                    folders: [{
                        folderId: 'folder-after-identity',
                        folderKey: 'folder-after-identity',
                        parentFolderId: null,
                        parentFolderKey: null,
                        sortKey: null,
                        display: { t: 'plain', v: { name: 'After identity' } },
                        archivedAt: null,
                        createdAt: 1,
                        updatedAt: 1,
                    }],
                    folderAssignments: [],
                    tags: [],
                    tagAssignments: [],
                    orderEntries: [],
                    labels: [],
                },
            });
        });

        await fetchAndApplySessionOrganizationSnapshot({
            credentials,
            serverId: localProfileId,
            request: { includeFolders: true },
        });

        const state = getStorage().getState();
        expect(state.sessionOrganizationFoldersByFolderKey[`${SERVER_ID}:folder-after-identity`]).toBeDefined();
        expect(state.sessionOrganizationFoldersByFolderKey[`${localProfileId}:folder-after-identity`]).toBeUndefined();
        expect(state.sessionOrganizationLoadingByServerId[localProfileId]).not.toBe(true);
        expect(state.sessionOrganizationLoadingByServerId[SERVER_ID]).toBe(false);
    });

    it('does not apply a snapshot if the scope is cancelled after display envelopes are opened', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { prepareSessionOrganizationDisplayEnvelope } = await import('./sessionOrganizationDisplayEnvelope');
        const { fetchAndApplySessionOrganizationSnapshot } = await import('./fetchSessionOrganizationSnapshot');
        const display = await prepareSessionOrganizationDisplayEnvelope({
            credentials,
            value: {
                name: 'Stale folder',
                workspace: { t: 'workspaceScope', serverId: SERVER_ID, machineId: 'machine-a', rootPath: '/repo' },
            },
        });
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse({
            snapshot: {
                schemaVersion: 1,
                version: 44,
                pins: [],
                folders: [{
                    folderId: 'folder-stale',
                    folderKey: 'folder-stale',
                    parentFolderId: null,
                    parentFolderKey: null,
                    sortKey: null,
                    display,
                    archivedAt: null,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                folderAssignments: [],
                tags: [],
                tagAssignments: [],
                orderEntries: [],
                labels: [],
            },
        }));
        let checks = 0;

        const applied = await fetchAndApplySessionOrganizationSnapshot({
            credentials,
            serverId: SERVER_ID,
            request: {
                includeFolders: true,
            },
            shouldContinue: () => {
                checks += 1;
                return checks === 1;
            },
        });

        expect(applied).toBe(false);
        expect(checks).toBeGreaterThanOrEqual(2);
        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey[`${SERVER_ID}:folder-stale`]).toBeUndefined();
    });
});
