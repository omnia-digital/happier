import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { createSessionFixture, createDeferred, createServerFetchWithReachabilityProbe, getServerFetchUrl } from '@/dev/testkit';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { SESSION_ACTION_PIN_ID } from '@/components/sessions/actions/sessionActionIds';
import { executeSessionAction } from '@/components/sessions/actions/sessionActionExecution';
import { getActiveServerId, setActiveServerId, setServerProfileIdentityForUrl, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { resolveSessionOrganizationMutationScope } from './mutationScope';

const serverUrl = 'https://organization-pin-race.example.test';
const initialState = storage.getState();
const initialServerId = getActiveServerId();
const token = (accountId: string) => `e30.${btoa(JSON.stringify({ sub: accountId }))}.signature`;

afterEach(() => {
    storage.setState(initialState, true);
    setActiveServerId(initialServerId, { scope: 'device' });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('session organization mutation account scope', () => {
    it('does not pin a shared session as a new account after credential lookup switches accounts', async () => {
        const profile = upsertServerProfile({ serverUrl });
        expect(setServerProfileIdentityForUrl(serverUrl, 'srv_organization_identity')?.serverIdentityId).toBe('srv_organization_identity');
        setActiveServerId(profile.id, { scope: 'device' });
        storage.setState({ profileScope: { serverId: profile.id, accountId: 'account-a' } });
        const credentialRead = createDeferred<{ token: string; secret: string }>();
        const readCredentials = vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockReturnValue(credentialRead.promise);
        const writes: Array<{ url: string; authorization: string | null }> = [];
        vi.stubGlobal('fetch', vi.fn(createServerFetchWithReachabilityProbe(async (input, init) => {
            const url = getServerFetchUrl(input);
            if (url.pathname.includes('/v2/session-organization/pins/')) {
                writes.push({ url: url.toString(), authorization: new Headers(init?.headers).get('Authorization') });
            }
            return new Response(JSON.stringify({ pin: { sessionId: 'shared-session', sortKey: null, pinnedAt: 1 } }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            });
        })));
        const target = createSessionActionTarget({
            session: createSessionFixture({ id: 'shared-session', owner: 'account-a' }),
            serverId: 'srv_organization_identity', currentUserId: 'account-a', isPinned: false,
        });

        const pending = executeSessionAction({ actionId: SESSION_ACTION_PIN_ID, target });
        await vi.waitFor(() => expect(readCredentials).toHaveBeenCalledTimes(1));
        storage.setState({ profileScope: { serverId: profile.id, accountId: 'account-b' } });
        credentialRead.resolve({ token: token('account-b'), secret: 'secret-b' });

        const outcome = await pending.then(() => null, (error: unknown) => error);
        expect(writes).toEqual([]);
        expect(outcome).toBeInstanceOf(Error);
        expect(storage.getState().sessionOrganizationPinsBySessionKey['srv_organization_identity:shared-session']).toBeUndefined();
    });

    it('accepts a saved foreign relay and auth startup when there is no captured account for that target', async () => {
        const active = upsertServerProfile({ serverUrl: 'https://organization-current.example.test' });
        const foreign = upsertServerProfile({ serverUrl: 'https://organization-foreign.example.test' });
        setActiveServerId(active.id, { scope: 'device' });
        storage.setState({ profileScope: { serverId: active.id, accountId: 'account-a' } });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token: token('foreign-account'), secret: 'foreign-secret' });

        const foreignScope = await resolveSessionOrganizationMutationScope(foreign.id);
        expect(foreignScope).toMatchObject({ ok: true, scope: { serverId: foreign.id, serverUrl: foreign.serverUrl } });

        setActiveServerId(foreign.id, { scope: 'device' });
        storage.setState({ profileScope: null });
        const startupScope = await resolveSessionOrganizationMutationScope(foreign.id);
        expect(startupScope).toMatchObject({ ok: true, scope: { serverId: foreign.id, serverUrl: foreign.serverUrl } });
    });

    it('keeps a completed A pin response out of B projection after the account changes during the API request', async () => {
        const profile = upsertServerProfile({ serverUrl });
        setActiveServerId(profile.id, { scope: 'device' });
        storage.setState({ profileScope: { serverId: profile.id, accountId: 'account-a' } });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token: token('account-a'), secret: 'secret-a' });
        const response = createDeferred<Response>();
        const writes: string[] = [];
        vi.stubGlobal('fetch', vi.fn(createServerFetchWithReachabilityProbe(async (input, init) => {
            if (getServerFetchUrl(input).pathname.includes('/v2/session-organization/pins/')) {
                writes.push(new Headers(init?.headers).get('Authorization') ?? '');
                return await response.promise;
            }
            return new Response('{}', { status: 404 });
        })));
        const target = createSessionActionTarget({
            session: createSessionFixture({ id: 'shared-session', owner: 'account-a' }),
            serverId: profile.id, currentUserId: 'account-a', isPinned: false,
        });

        const pending = executeSessionAction({ actionId: SESSION_ACTION_PIN_ID, target });
        await vi.waitFor(() => expect(writes).toEqual([`Bearer ${token('account-a')}`]));
        storage.setState({ profileScope: { serverId: profile.id, accountId: 'account-b' } });
        storage.getState().clearSessionOrganizationForServer(profile.id);
        const record = storage.getState().setSessionPinOptimistic(profile.id, 'shared-session', {
            sessionId: 'shared-session', sortKey: null, pinnedAt: 22,
        });
        storage.getState().commitSessionOrganizationOptimistic(record);
        const bPin = storage.getState().sessionOrganizationPinsBySessionKey[`${profile.id}:shared-session`];

        response.resolve(new Response(JSON.stringify({ pin: { sessionId: 'shared-session', sortKey: null, pinnedAt: 1 } }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        }));
        await pending;
        expect(storage.getState().sessionOrganizationPinsBySessionKey[`${profile.id}:shared-session`]).toEqual(bPin);
    });
});
