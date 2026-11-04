import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID,
    SESSION_ACTION_EDIT_TAGS_ID,
    SESSION_ACTION_MARK_READ_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_PIN_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_SET_ATTENTION_STANDING_ID,
    SESSION_ACTION_STOP_ID,
    SESSION_ACTION_UNARCHIVE_ID,
    SESSION_ACTION_UNPIN_ID,
} from '@/components/sessions/actions/sessionActionIds';
import { SESSION_COPY_DEBUG_INFORMATION_MENU_ITEM_ID } from '@/components/sessions/debug/sessionDebugMenuItem';
import { SESSION_NEW_SAME_SETUP_ACTION_ID } from '@/components/sessions/new/navigation/newSessionSameSetup';
import {
    SESSION_ATTENTION_REMINDER_CUSTOM_ID,
    SESSION_ATTENTION_REMINDER_MANAGE_PRESETS_ID,
    SESSION_ATTENTION_REMINDER_MENU_ID,
    SESSION_ATTENTION_REMINDER_NEXT_WEEK_ID,
    SESSION_ATTENTION_REMINDER_ONE_HOUR_ID,
    SESSION_ATTENTION_REMINDER_REMOVE_ID,
    SESSION_ATTENTION_REMINDER_THREE_HOURS_ID,
    SESSION_ATTENTION_REMINDER_TOMORROW_ID,
} from './row/actionMenu/sessionAttentionReminderAction';
import {
    getSessionRowMenuCommandId,
    SESSION_DELETE_DRAFT_MENU_ITEM_ID,
    SESSION_ROW_MENU_FORK_ID,
    SESSION_ROW_MENU_SELECT_ID,
    sessionRowMenuCommandIds,
} from './row/actionMenu/sessionRowMenuKeyboard';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routeState = vi.hoisted(() => ({ pathname: '/' }));
const keyboardState = vi.hoisted(() => ({
    handlers: null as Record<string, () => boolean | void> | null,
    onCommandHeldChange: null as ((held: boolean) => void) | null,
}));
const navigateToSession = vi.hoisted(() => vi.fn());
const archiveActionSpy = vi.hoisted(() => vi.fn(async (_params?: unknown): Promise<void> => undefined));
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
vi.mock('@/components/sessions/actions/sessionActionExecution', () => ({ executeSessionAction: archiveActionSpy }));

vi.mock('@/components/ui/lists/flashListCompat/SessionListVirtualizedList', async () => ({
    SessionListVirtualizedList: (await import('@/dev/testkit/mocks/flashList')).createCapturingFlashListMock({
        componentName: 'FlashListCompat',
        renderItems: true,
        memoizeItems: true,
    }).module.FlashList,
}));

vi.mock('@/keyboard/KeyboardShortcutProvider', () => ({
    useKeyboardShortcutHandlers: (
        handlers: Record<string, () => boolean | void>,
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

const sessionRowMenuItemIds = [
    SESSION_ROW_MENU_SELECT_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_MARK_READ_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_SET_ATTENTION_STANDING_ID,
    SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID,
    SESSION_ATTENTION_REMINDER_MENU_ID,
    SESSION_ATTENTION_REMINDER_ONE_HOUR_ID,
    SESSION_ATTENTION_REMINDER_THREE_HOURS_ID,
    SESSION_ATTENTION_REMINDER_TOMORROW_ID,
    SESSION_ATTENTION_REMINDER_NEXT_WEEK_ID,
    SESSION_ATTENTION_REMINDER_CUSTOM_ID,
    SESSION_ATTENTION_REMINDER_MANAGE_PRESETS_ID,
    SESSION_ATTENTION_REMINDER_REMOVE_ID,
    SESSION_NEW_SAME_SETUP_ACTION_ID,
    SESSION_DELETE_DRAFT_MENU_ITEM_ID,
    SESSION_COPY_DEBUG_INFORMATION_MENU_ITEM_ID,
    SESSION_ROW_MENU_FORK_ID,
    SESSION_ACTION_STOP_ID,
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_UNARCHIVE_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_EDIT_TAGS_ID,
    SESSION_ACTION_PIN_ID,
    SESSION_ACTION_UNPIN_ID,
] as const;

describe('SessionsList numbered shortcuts', () => {
    beforeEach(() => {
        routeState.pathname = '/';
        keyboardState.handlers = null;
        keyboardState.onCommandHeldChange = null;
        navigateToSession.mockClear();
        archiveActionSpy.mockReset();
        archiveActionSpy.mockResolvedValue(undefined);
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

    it('targets the open menu row before the hovered or selected row and declines a disabled action', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const rows = screen.root.findAllByType('SessionItem' as any);
        const first = rows.find((row) => row.props.session.id === 's1')!;
        const second = rows.find((row) => row.props.session.id === 's2')!;
        const firstAction = vi.fn(async () => undefined);
        const secondAction = vi.fn(async () => undefined);
        const renameItem = { id: 'ui.session.rename', title: 'Rename' };

        await act(async () => {
            first.props.onShortcutTargetChange?.('server_a:s1', {
                target: { sessionId: 's1', serverId: 'server_a' }, items: [renameItem], execute: firstAction, mutating: false,
            });
            second.props.onShortcutTargetChange?.('server_a:s2', {
                target: { sessionId: 's2', serverId: 'server_a' }, items: [renameItem], execute: secondAction, mutating: false,
            });
            first.props.onShortcutPresenceChange?.('server_a:s1', 'hover', true);
            second.props.onShortcutPresenceChange?.('server_a:s2', 'menu', true);
        });
        expect(keyboardState.handlers?.['session.menu.rename']?.()).toBe(true);
        await act(async () => undefined);
        expect(secondAction).toHaveBeenCalledWith('ui.session.rename', undefined);
        expect(firstAction).not.toHaveBeenCalled();

        await act(async () => {
            second.props.onShortcutTargetChange?.('server_a:s2', {
                target: { sessionId: 's2', serverId: 'server_a' },
                items: [{ ...renameItem, disabled: true }], execute: secondAction, mutating: false,
            });
        });
        expect(keyboardState.handlers?.['session.menu.rename']?.()).toBe(false);
        expect(secondAction).toHaveBeenCalledTimes(1);
    });

    describe('session row menu inventory', () => {
        const usesArchiveConfirmation = (itemId: string) => itemId === SESSION_ACTION_ARCHIVE_ID;
        const renderTargetedRows = async (items: readonly unknown[]) => {
            routeState.pathname = '/session/s2';
            const { SessionsListContent } = await import('./SessionsList');
            const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
            const rows = screen.root.findAllByType('SessionItem' as any);
            const targeted = vi.fn(async () => undefined);
            const selected = vi.fn(async () => undefined);
            await act(async () => {
                for (const [sessionId, execute] of [['s1', targeted], ['s2', selected]] as const) {
                    rows.find((row) => row.props.session.id === sessionId)?.props.onShortcutTargetChange(`server_a:${sessionId}`, {
                        target: { sessionId, serverId: 'server_a' }, items, execute, mutating: false,
                    });
                }
                rows.find((row) => row.props.session.id === 's1')?.props.onShortcutPresenceChange('server_a:s1', 'hover', true);
            });
            return { targeted, selected };
        };

        it('names every command the row menu binds', () => {
            expect(new Set(sessionRowMenuItemIds.map(getSessionRowMenuCommandId))).toEqual(new Set(sessionRowMenuCommandIds));
        });

        it.each(sessionRowMenuItemIds)('runs %s on the targeted row rather than the selected row', async (itemId) => {
            const { targeted, selected } = await renderTargetedRows([{ id: itemId, title: itemId }]);

            expect(keyboardState.handlers?.[getSessionRowMenuCommandId(itemId)!]?.()).toBe(true);
            await act(async () => undefined);

            expect(targeted).toHaveBeenCalledTimes(1);
            expect(targeted).toHaveBeenCalledWith(
                itemId,
                usesArchiveConfirmation(itemId) ? { forceArchiveConfirmation: true } : undefined,
            );
            expect(selected).not.toHaveBeenCalled();
        });

        it.each(sessionRowMenuItemIds)('declines %s when the targeted row has it disabled', async (itemId) => {
            const { targeted, selected } = await renderTargetedRows([{ id: itemId, title: itemId, disabled: true }]);

            expect(keyboardState.handlers?.[getSessionRowMenuCommandId(itemId)!]?.()).toBe(false);
            await act(async () => undefined);

            expect(targeted).not.toHaveBeenCalled();
            expect(selected).not.toHaveBeenCalled();
        });

        it('reaches a command nested in a submenu', async () => {
            const { targeted } = await renderTargetedRows([{
                id: SESSION_ATTENTION_REMINDER_MENU_ID,
                title: 'Remind me',
                submenu: { items: [{ id: SESSION_ATTENTION_REMINDER_ONE_HOUR_ID, title: 'In 1 hour' }] },
            }]);

            expect(keyboardState.handlers?.['session.menu.reminderOneHour']?.()).toBe(true);
            await act(async () => undefined);

            expect(targeted).toHaveBeenCalledWith(SESSION_ATTENTION_REMINDER_ONE_HOUR_ID, undefined);
        });
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

    it('archives the hovered row instead of the selected row, captures the target, and rejects repeat dispatch', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const rows = () => screen.root.findAllByType('SessionItem' as any);
        const targetA = { sessionId: 's3', serverId: 'server_a', canArchive: true, isArchived: false } as any;
        const targetB = { sessionId: 's1', serverId: 'server_a', canArchive: true, isArchived: false } as any;
        let finishArchive: (() => void) | undefined;
        archiveActionSpy.mockImplementation(() => new Promise<void>((resolve) => { finishArchive = resolve; }));

        await act(async () => {
            rows()[0]?.props.onShortcutTargetChange('server_a:s3', {
                target: targetA,
                items: [{ id: 'ui.session.archive', title: 'Archive' }],
                execute: (_itemId: string, options: unknown) => archiveActionSpy({ target: targetA, context: options }),
                mutating: false,
            });
            rows()[0]?.props.onShortcutPresenceChange('server_a:s3', 'hover', true);
        });
        await act(async () => { keyboardState.handlers?.['session.hovered.archive']?.(); });
        await act(async () => {
            rows()[1]?.props.onShortcutTargetChange('server_a:s1', {
                target: targetB,
                items: [{ id: 'ui.session.archive', title: 'Archive' }],
                execute: (_itemId: string, options: unknown) => archiveActionSpy({ target: targetB, context: options }),
                mutating: false,
            });
            rows()[1]?.props.onShortcutPresenceChange('server_a:s1', 'hover', true);
        });
        await act(async () => { keyboardState.handlers?.['session.hovered.archive']?.(); });
        expect(archiveActionSpy).toHaveBeenCalledTimes(1);
        expect(archiveActionSpy).toHaveBeenCalledWith(expect.objectContaining({
            target: targetA,
            context: expect.objectContaining({ forceArchiveConfirmation: true }),
        }));
        expect(navigateToSession).not.toHaveBeenCalled();
        await act(async () => { finishArchive?.(); });
    });

    it('does not archive the selected row after hover and focus leave, while other menu commands retain selected fallback', async () => {
        routeState.pathname = '/session/s3';
        listViewData.items = [sessionRow('s3')];
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const row = screen.root.findByType('SessionItem' as any);
        const execute = vi.fn(async () => undefined);
        await act(async () => {
            row.props.onShortcutTargetChange('server_a:s3', {
                target: { sessionId: 's3', serverId: 'server_a', canArchive: true, isArchived: false },
                items: [
                    { id: 'ui.session.archive', title: 'Archive' },
                    { id: 'ui.session.rename', title: 'Rename' },
                ],
                execute,
                mutating: false,
            });
        });
        expect(keyboardState.handlers?.['session.hovered.archive']?.()).toBe(false);
        expect(execute).not.toHaveBeenCalled();
        expect(keyboardState.handlers?.['session.menu.rename']?.()).toBe(true);
        await act(async () => undefined);
        expect(execute).toHaveBeenCalledWith('ui.session.rename', undefined);
    });

    it('clears hovered Archive on leave, scroll, missing projection and inactive surface', async () => {
        const { SessionsListContent } = await import('./SessionsList');
        const screen = await renderScreen(<SessionsListContent data={listViewData.items} />);
        const target = { sessionId: 's3', serverId: 'server_a', canArchive: true, isArchived: false } as any;
        const hover = () => {
            const row = screen.root.findAllByType('SessionItem' as any)[0];
            row?.props.onShortcutTargetChange('server_a:s3', {
                target, items: [{ id: 'ui.session.archive', title: 'Archive' }],
                execute: (_itemId: string, options: unknown) => archiveActionSpy({ target, context: options }),
                mutating: false,
            });
            row?.props.onShortcutPresenceChange('server_a:s3', 'hover', true);
        };
        await act(async () => { hover(); });
        await act(async () => { screen.root.findByType('FlashListCompat' as any).props.onScroll({ nativeEvent: {} }); });
        expect(keyboardState.handlers?.['session.hovered.archive']?.()).toBe(false);
        expect(archiveActionSpy).not.toHaveBeenCalled();

        await act(async () => { hover(); });
        await act(async () => { screen.root.findAllByType('SessionItem' as any)[0]?.props.onShortcutPresenceChange('server_a:s3', 'hover', false); });
        expect(keyboardState.handlers?.['session.hovered.archive']?.()).toBe(false);
        expect(archiveActionSpy).not.toHaveBeenCalled();

        await act(async () => { hover(); });
        listViewData.items = [sessionRow('s1')];
        await act(async () => { screen.tree.update(<SessionsListContent data={listViewData.items} />); });
        expect(keyboardState.handlers?.['session.hovered.archive']?.()).toBe(false);
        expect(archiveActionSpy).not.toHaveBeenCalled();

        await act(async () => { screen.tree.update(<SessionsListContent data={listViewData.items} surfaceOwnership={{ interactive: false, dataActive: false }} />); });
        expect(keyboardState.handlers?.['session.hovered.archive']).toBeUndefined();
    });
});
