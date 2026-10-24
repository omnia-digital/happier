import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';

import { createMachineFixture, createServerFetchWithReachabilityProbe, renderScreen, standardCleanup } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { decrypt, encrypt } from '../../../../../cli/src/api/encryption';
import { installModalComponentCommonModuleMocks } from '@/modal/components/modalComponentTestHelpers';
import { SelectableRow } from '@/components/ui/lists/SelectableRow';
import { storage } from '@/sync/domains/state/storageStore';
import {
    setActiveServerId,
    setServerProfileIdentityForUrl,
    upsertServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { deriveAccountMachineKeyFromRecoverySecret, RPC_METHODS, sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';

const transport = vi.hoisted(() => ({
    respond: vi.fn<(request: { serverUrl: string; token: string; method: string; params: string }) => Promise<unknown>>(),
}));
// Only the wire is mocked: credential lookup, Home routing, key-envelope opening,
// request encryption and response decryption all execute in their real owners.
vi.mock('socket.io-client', () => ({
    io: (serverUrl: string, options: { auth: { token: string } }) => {
        const socket = {
            connected: true,
            on: () => socket,
            onAny: () => socket,
            off: () => socket,
            connect: () => socket,
            disconnect: () => socket,
            emit: () => socket,
            emitWithAck: async (_event: string, payload: { method: string; params: string }) =>
                transport.respond({ serverUrl, token: options.auth.token, ...payload }),
            timeout: () => socket,
        };
        return socket;
    },
}));

installModalComponentCommonModuleMocks();

let activeServerId = '';
const remoteServerId = 'srv_oh56_palette_remote';
const activeServerUrl = 'https://oh56-palette-active.example.test';
const remoteServerUrl = 'https://oh56-palette-remote.example.test';
const memoryStatus = {
    v: 1, enabled: true, indexMode: 'hints', hintsIndexReady: true,
    deepIndexReady: false, activeIndexReady: true, activeIndexSearchable: true,
    embeddingsEnabled: false, embeddingsMode: 'disabled', embeddingsPresetId: null,
    embeddingsProviderKind: null, embeddingsModelId: null, embeddingsRuntimeState: 'ready',
    embeddingsUsingFallback: false, tier1DbPath: '/tmp/index', deepDbPath: null,
    tier1DbBytes: 100, deepDbBytes: null,
};
const memoryHit = (sessionId: string) => ({ v: 1, ok: true, hits: [{
    sessionId, seqFrom: 7, seqTo: 8, createdAtFromMs: 1, createdAtToMs: 2,
    summary: 'A matching indexed summary', score: 0.8,
}] });

function makeAccount(token: string) {
    const recoverySecret = new Uint8Array(randomBytes(32));
    const machineKey = deriveAccountMachineKeyFromRecoverySecret(recoverySecret);
    const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
    const envelope = sealEncryptedDataKeyEnvelopeV1({ dataKey: machineKey, recipientPublicKey: publicKey, randomBytes });
    return { credentials: { token, secret: encodeBase64(recoverySecret, 'base64url') }, machineKey, envelope };
}

function makeRow(id: string, title: string, updatedAt: number, serverId = activeServerId): SessionListViewItem {
    return {
        type: 'session',
        serverId,
        serverName: serverId === activeServerId ? 'Home A' : 'Home B',
        session: {
            id, updatedAt, archivedAt: null,
            metadata: { name: title, path: `/work/${id}`, host: `${serverId}.host` },
        },
    } as SessionListViewItem;
}

function publishRows(activeRows: SessionListViewItem[], remoteRows: SessionListViewItem[] = []) {
    storage.setState({
        sessionListViewData: activeRows,
        sessionListViewDataByServerId: remoteRows.length > 0 ? { [remoteServerId]: remoteRows } : {},
    });
}

async function expectRowsEventually(screen: Awaited<ReturnType<typeof renderScreen>>, titles: string[]) {
    await vi.waitFor(async () => {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(titles);
    }, { interval: 1 });
}

describe('CommandPalette session search through the real scoped session-list store', () => {
    let restoreLocalStorage: (() => void) | undefined;
    let accountA: ReturnType<typeof makeAccount>;
    let accountB: ReturnType<typeof makeAccount>;
    let remoteAccount: ReturnType<typeof makeAccount>;

    async function prepareMemoryTransport(respond: (request: {
        method: string; machineId: string; serverUrl: string; token: string; payload: unknown;
    }) => unknown | Promise<unknown>) {
        accountA = makeAccount('account-a');
        accountB = makeAccount('account-b');
        remoteAccount = makeAccount('account-remote');
        const accounts = [accountA, accountB, remoteAccount];
        const accountFor = (token: string) => {
            const account = accounts.find((candidate) => candidate.credentials.token === token);
            if (!account) throw new Error(`Unexpected transport account: ${token}`);
            return account;
        };
        setActiveServerId(remoteServerId, { scope: 'device' });
        await TokenStorage.setCredentials(remoteAccount.credentials);
        setActiveServerId(activeServerId, { scope: 'device' });
        await TokenStorage.setCredentials(accountA.credentials);
        const features = createRootLayoutFeaturesResponse();
        vi.stubGlobal('fetch', vi.fn(createServerFetchWithReachabilityProbe(async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === '/v1/features') return Response.json(features);
            if (url.pathname !== '/v1/machines') throw new Error(`Unexpected HTTP request: ${url}`);
            const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
            const account = accountFor(token);
            expect(url.origin).toBe(account === remoteAccount ? remoteServerUrl : activeServerUrl);
            const machineIds = account === remoteAccount ? ['machine-remote'] : ['machine-a', 'machine-b'];
            return Response.json(machineIds.map((id) => ({ id, dataEncryptionKey: encodeBase64(account.envelope) })));
        })));
        transport.respond.mockImplementation(async (request) => {
            const account = accountFor(request.token);
            expect(request.serverUrl).toBe(account === remoteAccount ? remoteServerUrl : activeServerUrl);
            const separator = request.method.indexOf(':');
            const payload = decrypt(account.machineKey, 'dataKey', decodeBase64(request.params));
            expect(payload).not.toBeNull();
            const result = await respond({
                method: request.method.slice(separator + 1), machineId: request.method.slice(0, separator),
                serverUrl: request.serverUrl, token: request.token, payload,
            });
            return { ok: true, result: encodeBase64(encrypt(account.machineKey, 'dataKey', result)) };
        });
    }

    beforeEach(() => {
        transport.respond.mockReset();
        restoreLocalStorage = installLocalStorageMock().restore;
        vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `oh56-palette-${Math.random()}`);
        const active = upsertServerProfile({ serverUrl: 'https://oh56-palette-active.example.test' });
        const remote = upsertServerProfile({ serverUrl: 'https://oh56-palette-remote.example.test' });
        setServerProfileIdentityForUrl(active.serverUrl, 'srv_oh56_palette_active');
        setServerProfileIdentityForUrl(remote.serverUrl, remoteServerId);
        setActiveServerId(active.id, { scope: 'device' });
        activeServerId = getActiveServerSnapshot().serverId;
        storage.setState(storage.getInitialState(), true);
    });

    afterEach(async () => {
        standardCleanup();
        const { apiSocket } = await import('@/sync/api/session/apiSocket');
        const { serverScopedRpcSocketPool } = await import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcSocketPool');
        const { resetScopedMachineDataKeyCacheForTests } = await import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcPool');
        const { resetServerReachabilitySupervisors } = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
        apiSocket.disconnect();
        await serverScopedRpcSocketPool.stopAll();
        await resetServerReachabilitySupervisors();
        resetScopedMachineDataKeyCacheForTests();
        storage.setState(storage.getInitialState(), true);
        vi.unstubAllGlobals();
        restoreLocalStorage?.();
        vi.unstubAllEnvs();
    });

    it('retains actions and opens an outside-recent title with Enter, then dismisses with Escape', async () => {
        publishRows([
            ...Array.from({ length: 5 }, (_, index) => makeRow(`recent-${index}`, `Recent ${index}`, 100 - index)),
            makeRow('target', 'Release Checklist', 1),
        ]);
        const navigateToSession = vi.fn();
        const onClose = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const screen = await renderScreen(
            <CommandPalette
                commands={[{ id: 'settings', title: 'Settings', category: 'Navigation', action: vi.fn() }]}
                navigateToSession={navigateToSession}
                onClose={onClose}
            />,
        );
        const input = screen.findByType('TextInput');

        await act(async () => { input.props.onChangeText('rElEaSe'); });
        const rows = screen.findAllByType(SelectableRow);
        expect(rows.map((row) => row.props.title)).toEqual(['Release Checklist']);
        expect(rows[0]?.props.subtitle).toContain('Home A');
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('target', { serverId: activeServerId });
        expect(onClose).toHaveBeenCalledTimes(1);

        await act(async () => { input.props.onChangeText('settings'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Settings']);
        await act(async () => { input.props.onChangeText(''); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Escape' } }); });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('keeps similar titles in their Home scope and refreshes matches after a rename', async () => {
        storage.setState((state) => ({
            settings: {
                ...state.settings,
                serverSelectionGroups: [{ id: 'both', name: 'Both', serverIds: [activeServerId, remoteServerId], presentation: 'grouped' }],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'both',
            },
        }));
        publishRows(
            [makeRow('alpha', 'Deployment Notes', 20)],
            [makeRow('beta', 'Deployment Notes', 10, remoteServerId)],
        );
        const navigateToSession = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const screen = await renderScreen(<CommandPalette commands={[]} navigateToSession={navigateToSession} onClose={vi.fn()} />);
        const input = screen.findByType('TextInput');

        await act(async () => { input.props.onChangeText('DEPLOY'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.subtitle)).toEqual([
            expect.stringContaining('Home A'),
            expect.stringContaining('Home B'),
        ]);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'ArrowDown' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('beta', { serverId: remoteServerId });

        await act(async () => {
            publishRows(
                [makeRow('alpha', 'Deployment Notes', 20)],
                [makeRow('beta', 'Incident Retrospective', 10, remoteServerId)],
            );
        });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Deployment Notes']);
        await act(async () => { input.props.onChangeText('retrospect'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Incident Retrospective']);
        await act(async () => { input.props.onChangeText('nothing-matches'); });
        expect(screen.findAllByType(SelectableRow)).toHaveLength(0);
    });

    it('keeps Enter ready when an older match arrives after an empty result', async () => {
        publishRows([makeRow('recent', 'Recent Work', 20)]);
        const navigateToSession = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const screen = await renderScreen(<CommandPalette commands={[]} navigateToSession={navigateToSession} onClose={vi.fn()} />);
        const input = screen.findByType('TextInput');

        await act(async () => { input.props.onChangeText('older'); });
        expect(screen.findAllByType(SelectableRow)).toHaveLength(0);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'ArrowDown' } }); });
        await act(async () => { publishRows([makeRow('older', 'Older Research', 1)]); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Older Research']);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('older', { serverId: activeServerId });
    });

    it('searches indexed content in the chosen Home and machine, then opens its message location', async () => {
        storage.setState((state) => ({
            isDataReady: true,
            machines: {
                'machine-a': createMachineFixture({ id: 'machine-a' }),
            },
            settings: {
                ...state.settings,
                experiments: true,
                featureToggles: { ...state.settings.featureToggles, 'memory.search': true },
            },
        }));
        await prepareMemoryTransport(({ method, machineId, token, payload }) => {
            expect(token).toBe('account-a');
            expect(machineId).toBe('machine-a');
            if (method === RPC_METHODS.DAEMON_MEMORY_STATUS) return memoryStatus;
            if (method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                expect(payload).toMatchObject({ query: 'nebula', scope: { type: 'global' } });
                return memoryHit('content-only');
            }
            throw new Error(`Unexpected machine RPC: ${method}`);
        });
        const navigateToSession = vi.fn();
        const onClose = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const screen = await renderScreen(<CommandPalette commands={[]} navigateToSession={navigateToSession} onClose={onClose} />);
        const input = screen.findByType('TextInput');

        await act(async () => { screen.findByTestId('command-palette:content-mode')?.props.onPress(); });
        await act(async () => { input.props.onChangeText('nebula'); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await expectRowsEventually(screen, ['Session content-']);
        expect(transport.respond).toHaveBeenCalledWith(expect.objectContaining({
            method: `machine-a:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`, serverUrl: activeServerUrl, token: 'account-a',
        }));
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('content-only', { serverId: activeServerId, query: { jumpSeq: 7 } });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('drops an in-flight indexed result when credentials change on the same Home', async () => {
        storage.setState((state) => ({
            isDataReady: true,
            machines: {
                'machine-a': createMachineFixture({ id: 'machine-a' }),
            },
            settings: {
                ...state.settings,
                experiments: true,
                featureToggles: { ...state.settings.featureToggles, 'memory.search': true },
            },
        }));
        let releaseOld: ((value: unknown) => void) | null = null;
        const oldResult = new Promise<unknown>((resolve) => { releaseOld = resolve; });
        await prepareMemoryTransport(({ method, token }) => {
            if (method === RPC_METHODS.DAEMON_MEMORY_STATUS) return memoryStatus;
            if (method !== RPC_METHODS.DAEMON_MEMORY_SEARCH) throw new Error(`Unexpected RPC ${method}`);
            return token === 'account-a' ? oldResult : memoryHit('new-account');
        });
        const { CommandPalette } = await import('./CommandPalette');
        const screen = await renderScreen(<CommandPalette commands={[]} navigateToSession={vi.fn()} onClose={vi.fn()} />);
        const input = screen.findByType('TextInput');
        await act(async () => { screen.findByTestId('command-palette:content-mode')?.props.onPress(); });
        await act(async () => { input.props.onChangeText('nebula'); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await vi.waitFor(async () => {
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
            expect(transport.respond).toHaveBeenCalledWith(expect.objectContaining({
                method: `machine-a:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`, token: 'account-a',
            }));
        }, { interval: 1 });
        const oldCallIndex = transport.respond.mock.calls.findIndex(([request]) => request.method === `machine-a:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`);
        const oldResponse = transport.respond.mock.results[oldCallIndex]!.value;

        await act(async () => { await TokenStorage.setCredentials(accountB.credentials); });
        await expectRowsEventually(screen, ['Session new-acco']);
        expect(transport.respond).toHaveBeenCalledWith(expect.objectContaining({
            method: `machine-a:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`, token: 'account-b', serverUrl: activeServerUrl,
        }));
        await act(async () => {
            releaseOld?.(memoryHit('old-account'));
            await oldResponse;
        });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Session new-acco']);
        await act(async () => { input.props.onChangeText(''); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual([]);
    });

    it('changes indexed search machine and Home without retaining the previous scope', async () => {
        const makeMachine = (id: string) => createMachineFixture({
            id, metadata: { ...createMachineFixture().metadata!, host: id, displayName: id },
        });
        storage.setState((state) => ({
            isDataReady: true,
            machines: { 'machine-a': makeMachine('machine-a'), 'machine-b': makeMachine('machine-b') },
            machineListByServerId: { [remoteServerId]: [makeMachine('machine-remote')] },
            settings: {
                ...state.settings,
                experiments: true,
                featureToggles: { ...state.settings.featureToggles, 'memory.search': true },
                serverSelectionGroups: [{ id: 'both', name: 'Both', serverIds: [activeServerId, remoteServerId], presentation: 'grouped' }],
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: 'both',
            },
        }));
        await prepareMemoryTransport(({ method, serverUrl, machineId }) => {
            if (method === RPC_METHODS.DAEMON_MEMORY_STATUS) return memoryStatus;
            if (method === RPC_METHODS.DAEMON_MEMORY_SEARCH) return memoryHit(
                serverUrl === remoteServerUrl ? 'remote-hit' : machineId === 'machine-b' ? 'machine-two' : 'first-hit',
            );
            throw new Error(`Unexpected RPC ${method}`);
        });
        const navigateToSession = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const focus = vi.fn();
        const screen = await renderScreen(<CommandPalette commands={[]} navigateToSession={navigateToSession} onClose={vi.fn()} />, {
            createNodeMock: (element) => element.type === 'TextInput' ? { focus } : null,
        });
        const input = screen.findByType('TextInput');
        await act(async () => { screen.findByTestId('command-palette:content-mode')?.props.onPress(); });
        await act(async () => { input.props.onChangeText('nebula'); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await expectRowsEventually(screen, ['Session first-hi']);

        focus.mockClear();
        await act(async () => { screen.findByTestId('command-palette:change-machine')?.props.onPress(); });
        expect(focus).toHaveBeenCalled();
        expect(input.props.value).toBe('');
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['machine-a', 'machine-b']);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'ArrowDown' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onChangeText('nebula'); });
        await expectRowsEventually(screen, ['Session machine-']);
        expect(transport.respond).toHaveBeenCalledWith(expect.objectContaining({ method: `machine-b:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`, serverUrl: activeServerUrl, token: 'account-a' }));

        focus.mockClear();
        await act(async () => { screen.findByTestId('command-palette:change-home')?.props.onPress(); });
        expect(focus).toHaveBeenCalled();
        expect(input.props.value).toBe('');
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).not.toContain('Session machine-');
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'ArrowDown' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        await act(async () => { input.props.onChangeText('nebula'); });
        await expectRowsEventually(screen, ['Session remote-h']);
        expect(transport.respond).toHaveBeenCalledWith(expect.objectContaining({ method: `machine-remote:${RPC_METHODS.DAEMON_MEMORY_SEARCH}`, serverUrl: remoteServerUrl, token: 'account-remote' }));
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('remote-hit', { serverId: remoteServerId, query: { jumpSeq: 7 } });
    });
});
