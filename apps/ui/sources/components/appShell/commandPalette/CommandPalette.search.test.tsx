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
});
