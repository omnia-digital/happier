import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installModalComponentCommonModuleMocks } from '@/modal/components/modalComponentTestHelpers';
import { SelectableRow } from '@/components/ui/lists/SelectableRow';
import { storage } from '@/sync/domains/state/storageStore';
import {
    setActiveServerId,
    setServerProfileIdentityForUrl,
    upsertServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { RPC_METHODS } from '@happier-dev/protocol';

const machineRpcSpy = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcSpy,
}));

installModalComponentCommonModuleMocks();

let activeServerId = '';
const remoteServerId = 'srv_oh56_palette_remote';

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

describe('CommandPalette session search through the real scoped session-list store', () => {
    beforeEach(() => {
        machineRpcSpy.mockReset();
        vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `oh56-palette-${Math.random()}`);
        const active = upsertServerProfile({ serverUrl: 'https://oh56-palette-active.example.test' });
        const remote = upsertServerProfile({ serverUrl: 'https://oh56-palette-remote.example.test' });
        setServerProfileIdentityForUrl(active.serverUrl, 'srv_oh56_palette_active');
        setServerProfileIdentityForUrl(remote.serverUrl, remoteServerId);
        setActiveServerId(active.id, { scope: 'device' });
        activeServerId = getActiveServerSnapshot().serverId;
        storage.setState(storage.getInitialState(), true);
    });

    afterEach(() => {
        standardCleanup();
        storage.setState(storage.getInitialState(), true);
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
                'machine-a': {
                    id: 'machine-a', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
                    metadata: { host: 'machine-a', displayName: 'Machine A', platform: 'darwin', homeDir: '/work' },
                    metadataVersion: 1, daemonState: null, daemonStateVersion: 0,
                },
            } as any,
            settings: {
                ...state.settings,
                experiments: true,
                featureToggles: { ...state.settings.featureToggles, 'memory.search': true },
            },
        }));
        machineRpcSpy.mockImplementation(async ({ method, serverId, machineId }: { method: string; serverId: string; machineId: string }) => {
            expect(serverId).toBe(activeServerId);
            expect(machineId).toBe('machine-a');
            if (method === RPC_METHODS.DAEMON_MEMORY_STATUS) {
                return {
                    v: 1, enabled: true, indexMode: 'hints', hintsIndexReady: true,
                    deepIndexReady: false, activeIndexReady: true, activeIndexSearchable: true,
                    embeddingsEnabled: false, embeddingsMode: 'disabled', embeddingsPresetId: null,
                    embeddingsProviderKind: null, embeddingsModelId: null, embeddingsRuntimeState: 'ready',
                    embeddingsUsingFallback: false, tier1DbPath: '/tmp/index', deepDbPath: null,
                    tier1DbBytes: 100, deepDbBytes: null,
                };
            }
            if (method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                return {
                    v: 1, ok: true,
                    hits: [{ sessionId: 'content-only', seqFrom: 7, seqTo: 8,
                        createdAtFromMs: 1, createdAtToMs: 2, summary: 'A summary about nebula findings', score: 0.8 }],
                };
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
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
        expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
            payload: expect.objectContaining({ query: 'nebula', scope: { type: 'global' } }),
        }));
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Session content-']);
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('content-only', { serverId: activeServerId, query: { jumpSeq: 7 } });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
