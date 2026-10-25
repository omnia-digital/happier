import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';

const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64')}.signature`, secret: 'secret-a' };

const mocks = vi.hoisted(() => ({
    serverFetch: vi.fn(),
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

function organizationSnapshotResponse(assignments: unknown[]) {
    return {
        snapshot: {
            schemaVersion: 1,
            version: 1,
            pins: [],
            folders: [],
            folderAssignments: assignments,
            tags: [],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
        },
    };
}

describe('fetchAndApplySessionFolderAssignments', () => {
    beforeEach(async () => {
        expect(upsertServerProfile({ serverUrl: 'https://server-a' }).id).toBe('server-a');
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
        mocks.serverFetch.mockReset();
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        getStorage().getState().clearSessionOrganizationForServer('server-a');
    });
    afterEach(() => vi.restoreAllMocks());

    it('applies fetched assignments to the organization assignment cache', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse(organizationSnapshotResponse([
            { sessionId: 's1', folderId: 'folder-a' },
        ])));

        await fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1'],
        });

        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey['server-a:s1']).toBe('folder-a');
        expect(getStorage().getState().sessionOrganizationLoadingByServerId['server-a']).toBe(false);
    });

    it('ignores legacy-only cached assignments when fetching missing organization assignments', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        getStorage().setState({
            sessionFolderAssignmentsBySessionKey: { 'server-a:s1': 'legacy-folder' },
            sessionOrganizationFolderAssignmentsBySessionKey: {},
        });
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse(organizationSnapshotResponse([
            { sessionId: 's1', folderId: 'folder-a' },
        ])));

        await fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1'],
            fetchPolicy: 'missing',
        });

        expect(mocks.serverFetch).toHaveBeenCalledWith(
            '/v2/session-organization?includeFolders=false&includeTags=false&includeLabels=false&assignmentSessionIds=s1',
            expect.anything(),
            expect.anything(),
        );
        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey['server-a:s1']).toBe('folder-a');
    });

    it('marks requested sessions without returned assignments as unassigned', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        mocks.serverFetch.mockResolvedValueOnce(jsonResponse(organizationSnapshotResponse([
            { sessionId: 's2', folderId: 'folder-b' },
        ])));

        await fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1', 's2', 's3'],
            fetchPolicy: 'missing',
        });

        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': null,
            'server-a:s2': 'folder-b',
            'server-a:s3': null,
        });
    });

    it('does not overwrite organization assignments that become known while a missing-only fetch is in flight', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        let resolveResponse: ((response: Response) => void) | undefined;
        mocks.serverFetch.mockReturnValueOnce(new Promise((resolve) => {
            resolveResponse = resolve;
        }));

        const fetchPromise = fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1'],
            fetchPolicy: 'missing',
        });
        getStorage().getState().applySessionFolderAssignments('server-a', [
            { sessionId: 's1', folderId: 'folder-local' },
        ]);
        resolveResponse?.(jsonResponse(organizationSnapshotResponse([])));
        await fetchPromise;

        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey['server-a:s1']).toBe('folder-local');
    });

    it('does not duplicate missing-only assignment requests already in flight', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        let releaseResponses: (() => void) | undefined;
        const responseGate = new Promise<void>((resolve) => {
            releaseResponses = resolve;
        });
        mocks.serverFetch.mockImplementation(async () => {
            await responseGate;
            return jsonResponse(organizationSnapshotResponse([{ sessionId: 's1', folderId: 'folder-a' }]));
        });

        const firstFetch = fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1', 's2'],
            fetchPolicy: 'missing',
        });
        const secondFetch = fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1', 's2'],
            fetchPolicy: 'missing',
        });

        releaseResponses?.();
        await Promise.all([firstFetch, secondFetch]);

        expect(mocks.serverFetch).toHaveBeenCalledTimes(1);
        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': 'folder-a',
            'server-a:s2': null,
        });
    });

    it('keeps missing-only assignment requests O(batches) across a full organization snapshot', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        const sessionIds = Array.from({ length: 12 }, (_, index) => `s${index + 1}`);
        mocks.serverFetch.mockImplementation(async () => jsonResponse(organizationSnapshotResponse([
            { sessionId: 's1', folderId: 'folder-a' },
        ])));

        // Arm the known set the way the visible session list does: one batched request
        // covering every visible row.
        await fetchAndApplySessionFolderAssignments({
            credentials,
            serverId: 'server-a',
            sessionIds,
            fetchPolicy: 'missing',
        });
        expect(mocks.serverFetch).toHaveBeenCalledTimes(1);

        // A session-list refresh applies the authoritative full snapshot, which lists
        // only the assigned sessions.
        getStorage().getState().applySessionOrganizationSnapshot('server-a', {
            schemaVersion: 1,
            version: 2,
            pins: [],
            folders: [],
            folderAssignments: [{ sessionId: 's1', folderId: 'folder-a' }],
            tags: [],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
        }, {
            includeFolders: true,
            includeTags: true,
            includeLabels: true,
            includeAllFolderAssignments: true,
            includeAllTagAssignments: true,
        });

        // Rows re-entering the visible source one at a time (per-session shell hydration)
        // must not each cost a request.
        for (const sessionId of sessionIds) {
            await fetchAndApplySessionFolderAssignments({
                credentials,
                serverId: 'server-a',
                sessionIds: [sessionId],
                fetchPolicy: 'missing',
            });
        }

        expect(mocks.serverFetch).toHaveBeenCalledTimes(1);
        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey).toMatchObject({
            'server-a:s1': 'folder-a',
            'server-a:s7': null,
            'server-a:s12': null,
        });
    });

    it('still fetches sessions a full organization snapshot never covered', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        mocks.serverFetch.mockImplementation(async () => jsonResponse(organizationSnapshotResponse([])));

        await fetchAndApplySessionFolderAssignments({
            credentials,
            serverId: 'server-a',
            sessionIds: ['s1'],
            fetchPolicy: 'missing',
        });
        getStorage().getState().applySessionOrganizationSnapshot('server-a', {
            schemaVersion: 1,
            version: 2,
            pins: [],
            folders: [],
            folderAssignments: [],
            tags: [],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
        }, { includeAllFolderAssignments: true, includeAllTagAssignments: true });
        mocks.serverFetch.mockClear();

        await fetchAndApplySessionFolderAssignments({
            credentials,
            serverId: 'server-a',
            sessionIds: ['s1', 's-new'],
            fetchPolicy: 'missing',
        });

        expect(mocks.serverFetch).toHaveBeenCalledTimes(1);
        expect(mocks.serverFetch).toHaveBeenCalledWith(
            '/v2/session-organization?includeFolders=false&includeTags=false&includeLabels=false&assignmentSessionIds=s-new',
            expect.anything(),
            expect.anything(),
        );
    });

    it('adopts an assignment a later full organization snapshot reports for a known-unassigned session', async () => {
        const { getStorage } = await import('@/sync/domains/state/storageStore');
        const { fetchAndApplySessionFolderAssignments } = await import('./fetchSessionFolderAssignments');
        mocks.serverFetch.mockImplementation(async () => jsonResponse(organizationSnapshotResponse([])));

        await fetchAndApplySessionFolderAssignments({
            credentials: credentials,
            serverId: 'server-a',
            sessionIds: ['s1'],
            fetchPolicy: 'missing',
        });
        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey['server-a:s1']).toBeNull();

        getStorage().getState().applySessionOrganizationSnapshot('server-a', {
            schemaVersion: 1,
            version: 2,
            pins: [],
            folders: [],
            folderAssignments: [{ sessionId: 's1', folderId: 'folder-later' }],
            tags: [],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
        }, { includeAllFolderAssignments: true, includeAllTagAssignments: true });

        expect(getStorage().getState().sessionOrganizationFolderAssignmentsBySessionKey['server-a:s1']).toBe('folder-later');
    });
});
