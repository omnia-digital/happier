import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routeState = vi.hoisted(() => ({ pathname: '/' }));
const keyboardState = vi.hoisted(() => ({
    handlers: null as Record<string, () => void> | null,
    onCommandHeldChange: null as ((held: boolean) => void) | null,
}));
const navigateToSession = vi.hoisted(() => vi.fn());
const listViewData = vi.hoisted(() => ({ items: null as any[] | null }));

installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ pathname: () => routeState.pathname }).module;
    },
});

vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-native-safe-area-context')>(),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

vi.mock('@/hooks/server/useEffectiveServerSelection', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/hooks/server/useEffectiveServerSelection')>(),
    useResolvedActiveServerSelection: () => ({
        enabled: true,
        presentation: 'grouped',
        activeServerId: 'server_a',
        allowedServerIds: ['server_a'],
    }),
}));

vi.mock('@/hooks/session/useNavigateToSession', () => ({
    useNavigateToSession: () => navigateToSession,
}));

vi.mock('@/components/ui/lists/flashListCompat/SessionListVirtualizedList', async () => ({
    SessionListVirtualizedList: (await import('@/dev/testkit/mocks/flashList')).createCapturingFlashListMock({
        componentName: 'FlashListCompat',
        renderItems: true,
        memoizeItems: true,
    }).module.FlashList,
}));

vi.mock('@/keyboard/KeyboardShortcutProvider', () => ({
    useKeyboardShortcutHandlers: (
        handlers: Record<string, () => void>,
        options?: { onCommandHeldChange?: (held: boolean) => void },
    ) => {
        keyboardState.handlers = handlers;
        keyboardState.onCommandHeldChange = options?.onCommandHeldChange ?? null;
        return true;
    },
}));

vi.mock('./SessionItem', () => ({
    SessionItem: (props: any) => React.createElement('SessionItem', props),
}));

vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({
    RecoveryKeyReminderBanner: 'RecoveryKeyReminderBanner',
}));

function sessionRow(sessionId: string) {
    return {
        type: 'session',
        serverId: 'server_a',
        serverName: 'Server A',
        groupKey: 'group-a',
        groupKind: 'date',
        session: {
            id: sessionId,
            seq: 1,
            createdAt: 1,
            updatedAt: 10,
            active: true,
            activeAt: 10,
            metadata: { path: '/tmp/project', host: 'host', homeDir: '/tmp', machineId: 'machine-1' },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        },
    };
}

describe('SessionsList numbered shortcuts', () => {
    beforeEach(() => {
        routeState.pathname = '/';
        keyboardState.handlers = null;
        keyboardState.onCommandHeldChange = null;
        navigateToSession.mockClear();
        listViewData.items = [
            { type: 'header', title: 'Pinned', headerKind: 'date', groupKey: 'group-a', serverId: 'server_a' },
            sessionRow('s3'),
            { type: 'header', title: 'Active', headerKind: 'date', groupKey: 'group-b', serverId: 'server_a' },
            sessionRow('s1'),
            sessionRow('s2'),
        ];
    });

    afterEach(() => standardCleanup());

    it('uses displayed row order for both held hints and Command-number targets', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const hints = () => screen.root.findAllByType('SessionItem' as any)
            .map((row) => [row.props.session.id, row.props.shortcutHint]);

        expect(hints()).toEqual([['s3', undefined], ['s1', undefined], ['s2', undefined]]);
        await act(async () => { keyboardState.onCommandHeldChange?.(true); });
        expect(hints()).toEqual([['s3', 1], ['s1', 2], ['s2', 3]]);
        await act(async () => { keyboardState.handlers?.['session.number.2']?.(); });
        expect(navigateToSession).toHaveBeenLastCalledWith('s1', { serverId: 'server_a' });
        await act(async () => { keyboardState.onCommandHeldChange?.(false); });
        expect(hints()).toEqual([['s3', undefined], ['s1', undefined], ['s2', undefined]]);
    });

    it('clears held hints while the sidebar is inactive and keeps them clear on return', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const hints = () => screen.root.findAllByType('SessionItem' as any)
            .map((row) => row.props.shortcutHint);

        await act(async () => { keyboardState.onCommandHeldChange?.(true); });
        expect(hints()).toEqual([1, 2, 3]);

        await act(async () => {
            screen.tree.update(<SessionsListContent data={listViewData.items} surfaceOwnership={{ interactive: false, dataActive: true }} />);
        });
        expect(keyboardState.handlers).toEqual({});
        expect(keyboardState.onCommandHeldChange).toBeNull();
        expect(hints()).toEqual([undefined, undefined, undefined]);

        await act(async () => { screen.tree.update(<SessionsListContent data={listViewData.items} />); });
        expect(hints()).toEqual([undefined, undefined, undefined]);
    });

    it('reassigns numbers when the visible projection changes order or excludes rows', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const hints = () => screen.root.findAllByType('SessionItem' as any)
            .map((row) => [row.props.session.id, row.props.shortcutHint]);
        await act(async () => { keyboardState.onCommandHeldChange?.(true); });

        listViewData.items = [
            { type: 'header', title: 'Active', headerKind: 'date', groupKey: 'group-b', serverId: 'server_a' },
            sessionRow('s2'),
            sessionRow('s3'),
        ];
        await act(async () => {
            screen.tree.update(<SessionsListContent data={listViewData.items} />);
        });
        expect(hints()).toEqual([['s2', 1], ['s3', 2]]);
        await act(async () => { keyboardState.handlers?.['session.number.1']?.(); });
        expect(navigateToSession).toHaveBeenLastCalledWith('s2', { serverId: 'server_a' });
        expect(keyboardState.handlers?.['session.number.3']).toBeUndefined();
    });
});
