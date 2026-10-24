import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installModalComponentCommonModuleMocks } from '@/modal/components/modalComponentTestHelpers';
import { SelectableRow } from '@/components/ui/lists/SelectableRow';

const source = vi.hoisted(() => ({
    rows: [] as Array<{
        type: 'session';
        serverId: string;
        serverName: string;
        session: { id: string; updatedAt: number; archivedAt: number | null; metadata: { name: string; path: string; host: string } };
    }>,
}));
const fetchRemainingSessions = vi.hoisted(() => vi.fn(async (_shouldContinue: () => boolean) => {}));

installModalComponentCommonModuleMocks();

vi.mock('@/sync/sync', () => ({ sync: { fetchRemainingSessions } }));

vi.mock('@/sync/store/hooks', async () => {
    const actual = await vi.importActual<typeof import('@/sync/store/hooks')>('@/sync/store/hooks');
    return {
        ...actual,
        useSessionListViewData: () => source.rows,
        useSessionListViewDataByServerId: () => ({}),
    };
});

vi.mock('@/hooks/server/useEffectiveServerSelection', () => ({
    useResolvedActiveServerSelection: () => ({
        enabled: false,
        activeServerId: 'server-a',
        allowedServerIds: ['server-a'],
    }),
}));

function makeRow(id: string, title: string, updatedAt: number, serverId = 'server-a') {
    return {
        type: 'session' as const,
        serverId,
        serverName: serverId === 'server-a' ? 'Home A' : 'Home B',
        session: {
            id,
            updatedAt,
            archivedAt: null,
            metadata: { name: title, path: `/work/${id}`, host: `${serverId}.host` },
        },
    };
}

describe('CommandPalette session search', () => {
    afterEach(() => {
        standardCleanup();
        source.rows = [];
        fetchRemainingSessions.mockClear();
    });

    it('keeps actions and opens an outside-recent title match with Enter, then dismisses with Escape', async () => {
        source.rows = [
            ...Array.from({ length: 5 }, (_, index) => makeRow(`recent-${index}`, `Recent ${index}`, 100 - index)),
            makeRow('target', 'Release Checklist', 1, 'server-b'),
        ];
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
        expect(fetchRemainingSessions).not.toHaveBeenCalled();

        await act(async () => { input.props.onChangeText('rElEaSe'); });
        expect(fetchRemainingSessions).toHaveBeenCalledTimes(1);
        const stillSearching = fetchRemainingSessions.mock.calls[0]?.[0];
        expect(stillSearching?.()).toBe(true);
        const rows = screen.findAllByType(SelectableRow);
        expect(rows.map((row) => row.props.title)).toEqual(['Release Checklist']);
        expect(rows[0]?.props.subtitle).toContain('Home B');
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('target', { serverId: 'server-b' });
        expect(onClose).toHaveBeenCalledTimes(1);

        await act(async () => { input.props.onChangeText('settings'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Settings']);
        await act(async () => { input.props.onChangeText(''); });
        expect(stillSearching?.()).toBe(false);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Escape' } }); });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('keeps keyboard selection scoped across similar titles and refreshes matches after a rename', async () => {
        source.rows = [
            makeRow('alpha', 'Deployment Notes', 20),
            makeRow('beta', 'Deployment Notes', 10, 'server-b'),
        ];
        const navigateToSession = vi.fn();
        const { CommandPalette } = await import('./CommandPalette');
        const props = {
            commands: [{ id: 'settings', title: 'Settings', category: 'Navigation', action: vi.fn() }],
            navigateToSession,
            onClose: vi.fn(),
        };
        const screen = await renderScreen(<CommandPalette {...props} />);
        const input = screen.findByType('TextInput');

        await act(async () => { input.props.onChangeText('DEPLOY'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.subtitle)).toEqual([
            expect.stringContaining('Home A'),
            expect.stringContaining('Home B'),
        ]);
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'ArrowDown' } }); });
        await act(async () => { input.props.onKeyPress({ nativeEvent: { key: 'Enter' } }); });
        expect(navigateToSession).toHaveBeenCalledWith('beta', { serverId: 'server-b' });

        source.rows = [source.rows[0]!, makeRow('beta', 'Incident Retrospective', 10, 'server-b')];
        await act(async () => { screen.tree.update(<CommandPalette {...props} />); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Deployment Notes']);
        await act(async () => { input.props.onChangeText('retrospect'); });
        expect(screen.findAllByType(SelectableRow).map((row) => row.props.title)).toEqual(['Incident Retrospective']);
        await act(async () => { input.props.onChangeText('nothing-matches'); });
        expect(screen.findAllByType(SelectableRow)).toHaveLength(0);
    });
});
