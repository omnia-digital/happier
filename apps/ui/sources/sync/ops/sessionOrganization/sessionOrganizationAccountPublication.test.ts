import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorage } from '@/sync/domains/state/storageStore';
import { upsertSessionFolder } from './upsertSessionFolder';
import { deleteSessionFolder } from './deleteSessionFolder';
import { reorderSessionOrganization } from './reorderSessionOrganization';
import { setSessionFolderAssignment } from './setSessionFolderAssignment';
import { moveSessionFolderAssignments } from './moveSessionFolderAssignments';

const boundary = vi.hoisted(() => ({
    credentials: { token: '', secret: 'secret' },
    upsert: vi.fn(), delete: vi.fn(), reorder: vi.fn(), assign: vi.fn(), move: vi.fn(),
    encryption: vi.fn(), encryptionMode: vi.fn(), readCredentials: vi.fn(),
    listeners: new Set<() => void>(),
}));
vi.mock('@/auth/storage/tokenStorage', async (original) => ({
    ...await original<typeof import('@/auth/storage/tokenStorage')>(),
    TokenStorage: {
        getCredentialsForServerUrl: (...args: unknown[]) => boundary.readCredentials(...args),
        subscribeCredentialChanges: (listener: () => void) => { boundary.listeners.add(listener); return () => { boundary.listeners.delete(listener); }; },
    },
}));
vi.mock('@/sync/domains/server/serverProfiles', async (original) => ({
    ...await original<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: () => ({ id: 'home', serverUrl: 'https://home.test' }),
}));
vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({ createEncryptionFromAuthCredentials: boundary.encryption }));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({ fetchAccountEncryptionMode: boundary.encryptionMode }));
vi.mock('@/sync/api/session/sessionOrganizationApi', async (original) => ({
    ...await original<typeof import('@/sync/api/session/sessionOrganizationApi')>(),
    upsertSessionOrganizationFolder: boundary.upsert,
    deleteSessionOrganizationFolder: boundary.delete,
    reorderSessionOrganization: boundary.reorder,
    setSessionFolderAssignment: boundary.assign,
    moveSessionFolderAssignments: boundary.move,
}));
const token = (accountId: string, signature = 'signature') => `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64')}.${signature}`;
const credentialsA = { token: token('account-a'), secret: 'secret' };
const workspace = { t: 'workspaceScope' as const, serverId: 'home', machineId: 'machine', rootPath: '/repo' };
const folder = (name: string) => ({ folderId: 'folder', folderKey: 'folder', parentFolderId: null, parentFolderKey: null,
    sortKey: 'a', display: { t: 'plain' as const, v: { name, workspace } }, archivedAt: null, createdAt: 1, updatedAt: 1 });
const request = { folderId: 'folder', folderKey: 'folder', parentFolderId: null, parentFolderKey: null,
    sortKey: 'b', display: folder('A edited').display };
const base = { credentials: credentialsA, serverId: 'home', serverUrl: 'https://home.test' };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function seed(accountId: string) {
    boundary.credentials = { token: token(accountId), secret: 'secret' };
    const store = getStorage();
    store.setState({ profileScope: { serverId: 'home', accountId } });
    store.getState().clearSessionOrganizationForServer('home');
    store.getState().applySessionOrganizationSnapshot('home', {
        schemaVersion: 1, version: 1, pins: [], folders: [folder(accountId)],
        folderAssignments: [{ sessionId: 'session', folderId: accountId }], tags: [], tagAssignments: [], labels: [],
        orderEntries: [{ scopeKind: 'group', scopeKey: 'repo', itemKind: 'session', itemKey: accountId, sortKey: 'a' }],
    });
}
function projection() {
    const state = getStorage().getState();
    return {
        folders: state.sessionOrganizationFoldersByFolderKey,
        assignments: state.sessionOrganizationFolderAssignmentsBySessionKey,
        orders: state.sessionOrganizationOrderEntriesByScopeKey,
    };
}
beforeEach(() => {
    for (const mock of [boundary.upsert, boundary.delete, boundary.reorder, boundary.assign, boundary.move, boundary.encryption, boundary.encryptionMode]) mock.mockReset();
    boundary.encryptionMode.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    boundary.encryption.mockResolvedValue({ getContentPrivateKey: () => new Uint8Array(32).fill(7) });
    boundary.readCredentials.mockReset();
    boundary.readCredentials.mockImplementation(async () => boundary.credentials);
    seed('account-a');
});

describe('organization mutations publish only to their captured account', () => {
    it('does not publish after an account switch during display encryption, while preserving the captured remote write', async () => {
        const crypto = deferred<{ getContentPrivateKey: () => Uint8Array }>();
        boundary.encryptionMode.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
        boundary.encryption.mockReturnValueOnce(crypto.promise);
        boundary.upsert.mockResolvedValue({ folder: folder('A response') });
        const pending = upsertSessionFolder({ ...base, request });
        await vi.waitFor(() => expect(boundary.encryption).toHaveBeenCalled());
        seed('account-b');
        const expected = projection();
        crypto.resolve({ getContentPrivateKey: () => new Uint8Array(32).fill(7) });
        await pending;
        expect(projection()).toEqual(expected);
        expect(boundary.upsert).toHaveBeenCalledWith(expect.objectContaining({ credentials: credentialsA, serverUrl: base.serverUrl }));
        expect(boundary.encryptionMode).toHaveBeenCalledWith(credentialsA, { endpointUrl: base.serverUrl });
    });

    const operations = [
        { name: 'upsert', api: boundary.upsert, run: () => upsertSessionFolder({ ...base, request }), response: { folder: folder('A response') } },
        { name: 'delete', api: boundary.delete, run: () => deleteSessionFolder({ ...base, request: { folderId: 'folder', assignmentBehavior: 'moveAssignmentsToParent' } }), response: { deletedFolderIds: ['folder'], affectedAssignmentCount: 1, assignmentTargetFolderId: null } },
        { name: 'order', api: boundary.reorder, run: () => reorderSessionOrganization({ ...base, request: { scopeKind: 'group', scopeKey: 'repo', entries: [{ itemKind: 'session', itemKey: 'A order', sortKey: 'b' }] } }), response: { orderEntries: [{ scopeKind: 'group', scopeKey: 'repo', itemKind: 'session', itemKey: 'A response', sortKey: 'c' }] } },
        { name: 'assignment', api: boundary.assign, run: () => setSessionFolderAssignment({ ...base, sessionId: 'session', folderId: 'A folder' }), response: { sessionId: 'session', folderId: 'A response' } },
        { name: 'bulk move', api: boundary.move, run: () => moveSessionFolderAssignments({ ...base, fromFolderIds: ['account-a'], toFolderId: 'A folder' }), response: { assignments: [{ sessionId: 'session' }], toFolderId: 'A response' } },
    ];
    for (const operation of operations) {
        it.each(['success', 'failure'] as const)(`${operation.name} does not reconcile or roll back A over B after API %s`, async (outcome) => {
            const response = deferred<unknown>();
            operation.api.mockReturnValue(response.promise);
            const pending = operation.run().catch(error => error);
            await vi.waitFor(() => expect(operation.api).toHaveBeenCalledTimes(1));
            seed('account-b');
            const expected = projection();
            if (outcome === 'success') response.resolve(operation.response);
            else response.reject(new Error('request failed'));
            await pending;
            expect(projection()).toEqual(expected);
        });
    }

    it('rejects a foreign account response while the active Home stays unchanged', async () => {
        getStorage().setState({ profileScope: { serverId: 'other-home', accountId: 'viewer' } });
        const response = deferred<unknown>();
        boundary.upsert.mockReturnValue(response.promise);
        const pending = upsertSessionFolder({ ...base, request });
        await vi.waitFor(() => expect(boundary.upsert).toHaveBeenCalledTimes(1));
        seed('account-b');
        getStorage().setState({ profileScope: { serverId: 'other-home', accountId: 'viewer' } });
        const expected = projection();
        response.resolve({ folder: folder('A response') });
        await pending;
        expect(projection()).toEqual(expected);
    });

    it('rechecks a foreign credential read invalidated by the canonical credential-change event', async () => {
        getStorage().setState({ profileScope: { serverId: 'other-home', accountId: 'viewer' } });
        const response = deferred<unknown>();
        boundary.upsert.mockReturnValue(response.promise);
        const pending = upsertSessionFolder({ ...base, request });
        await vi.waitFor(() => expect(boundary.upsert).toHaveBeenCalledTimes(1));
        const staleRead = deferred<typeof credentialsA>();
        boundary.readCredentials.mockReturnValueOnce(staleRead.promise);
        const readsBefore = boundary.readCredentials.mock.calls.length;
        response.resolve({ folder: folder('A response') });
        await vi.waitFor(() => expect(boundary.readCredentials.mock.calls.length).toBeGreaterThan(readsBefore));
        seed('account-b');
        getStorage().setState({ profileScope: { serverId: 'other-home', accountId: 'viewer' } });
        const expected = projection();
        for (const listener of boundary.listeners) listener();
        staleRead.resolve(credentialsA);
        await pending;
        expect(projection()).toEqual(expected);
        expect(boundary.listeners.size).toBe(0);
    });

    it('recognizes the active projection under the same Home legacy profile alias', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = profiles.upsertServerProfile({ serverUrl: base.serverUrl });
        const canonicalId = 'srv_home_identity';
        expect(profiles.setServerProfileIdentityForUrl(base.serverUrl, canonicalId)?.serverIdentityId).toBe(canonicalId);
        expect(profiles.areServerProfileIdentifiersEquivalent(profile.id, canonicalId)).toBe(true);
        getStorage().setState({ profileScope: { serverId: canonicalId, accountId: 'account-a' } });
        const response = deferred<unknown>();
        boundary.upsert.mockReturnValue(response.promise);
        const pending = upsertSessionFolder({ ...base, serverId: canonicalId, request });
        await vi.waitFor(() => expect(boundary.upsert).toHaveBeenCalledTimes(1));
        getStorage().getState().clearSessionOrganizationForServer(canonicalId);
        const id = getStorage().getState().upsertSessionOrganizationFolderOptimistic(canonicalId, folder('B current'));
        getStorage().getState().commitSessionOrganizationOptimistic(id);
        getStorage().setState({ profileScope: { serverId: profile.id, accountId: 'account-b' } });
        response.resolve({ folder: folder('A response') });
        await pending;
        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey[`${canonicalId}:folder`]?.display).toEqual(folder('B current').display);
    });

    it('accepts same-account token rotation while the API request is pending', async () => {
        const response = deferred<unknown>();
        boundary.upsert.mockReturnValue(response.promise);
        const pending = upsertSessionFolder({ ...base, request });
        await vi.waitFor(() => expect(boundary.upsert).toHaveBeenCalledTimes(1));
        boundary.credentials = { token: token('account-a', 'rotated'), secret: 'secret' };
        response.resolve({ folder: folder('Confirmed') });
        await pending;
        expect(getStorage().getState().sessionOrganizationFoldersByFolderKey['home:folder']?.display).toEqual(folder('Confirmed').display);
    });
});
