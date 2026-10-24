import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, pressTestInstanceAsync, renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionItemTestRowModel, installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import { SESSION_ACTION_RENAME_ID } from '@/components/sessions/actions/sessionActionIds';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { clearTempData, peekTempData, type NewSessionData } from '@/utils/sessions/tempDataStore';
import { SessionListSelectionProvider, useSessionListSelectionActions } from './selection/SessionListSelectionContext';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', () => ({}));
vi.mock('react-native-gesture-handler', () => ({ Swipeable: 'Swipeable' }));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));
vi.mock('@/utils/sessions/sessionUtils', () => ({
    getSessionName: () => 'Session',
    getSessionSubtitle: () => 'Subtitle',
    getSessionAvatarId: () => 'avatar',
    useSessionStatus: () => ({
        isConnected: true,
        statusText: 'Connected',
        statusColor: '#000',
        statusDotColor: '#0f0',
        isPulsing: false,
    }),
}));
vi.mock('@/components/ui/avatar/Avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/ui/status/StatusDot', () => ({ StatusDot: 'StatusDot' }));
vi.mock('@/agents/registry/AgentIcon', () => ({ AgentIcon: 'AgentIcon' }));
vi.mock('@/utils/platform/responsive', () => ({ useIsTablet: () => false }));
vi.mock('@/hooks/ui/useHappyAction', () => ({ useHappyAction: (fn: any) => [false, fn] }));

const navigateToSessionSpy = vi.fn();
const routerPushSpy = vi.fn();
let storage: (typeof import('@/sync/domains/state/storage'))['storage'];
let initialStorageState: ReturnType<typeof storage.getState>;
vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => navigateToSessionSpy }));
const renameSpy = vi.fn(async () => ({ success: true }));
vi.mock('@/sync/ops', async (importOriginal) => {
    const { createSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
    return createSyncOpsModuleMock({ importOriginal, overrides: { sessionRename: renameSpy } });
});
const promptSpy = vi.fn(async () => 'Renamed');
let platformOs: 'web' | 'ios' = 'web';
function SelectForMultiSelection(props: Readonly<{ selectionKey: string }>) {
    const actions = useSessionListSelectionActions();
    return React.createElement('SelectionModeControl', {
        testID: 'select-session-for-multi-selection',
        onPress: () => actions.replaceWith(props.selectionKey),
    });
}

installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ router: { push: routerPushSpy } }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { get OS() { return platformOs; } } });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { prompt: promptSpy } }).module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useHasUnreadMessages: () => false,
                useProfile: () => ({
                    id: 'u1', timestamp: 0, firstName: null, lastName: null, username: null, avatar: null,
                    linkedProviders: [], connectedServices: [], connectedServicesV2: [], connectedServiceCredentialRevisionsV1: [],
                }),
                useSession: () => null,
            },
        });
    },
});

type SessionItemProps = Omit<React.ComponentProps<(typeof import('./SessionItem'))['SessionItem']>, 'rowModel'> & {
    rowModel?: React.ComponentProps<(typeof import('./SessionItem'))['SessionItem']>['rowModel'];
};
let SessionItem: React.ComponentType<SessionItemProps>;

beforeAll(async () => {
    storage = (await import('@/sync/domains/state/storage')).storage;
    initialStorageState = storage.getState();
    const { SessionItem: ProductionSessionItem } = await import('./SessionItem');
    SessionItem = (props) => <ProductionSessionItem {...props} rowModel={props.rowModel ?? createSessionItemTestRowModel(props)} />;
});

afterEach(() => {
    standardCleanup();
    storage.setState(initialStorageState, true);
    clearTempData();
    routerPushSpy.mockClear();
    navigateToSessionSpy.mockClear();
    renameSpy.mockClear();
    promptSpy.mockReset();
    promptSpy.mockResolvedValue('Renamed');
    platformOs = 'web';
});

describe('SessionItem right-click menu (web)', () => {
    it('keeps the current-conversation indicator on the routed row while another row menu opens', async () => {
        const currentSession = createSessionFixture({ id: 'sess_current_conversation', active: true, metadata: null });
        const otherSession = createSessionFixture({ id: 'sess_other_conversation', active: true, metadata: null });
        const screen = await renderScreen(
            <>
                <SessionItem session={currentSession} serverId="server_right_click" selected isFirst variant="default" compact={false} />
                <SessionItem session={otherSession} serverId="server_right_click" selected={false} isLast variant="default" compact={false} />
            </>,
        );
        const currentIndicator = screen.findByTestId('session-item-current-indicator-sess_current_conversation');
        expect(currentIndicator).toBeTruthy();
        expect(screen.findByTestId('session-item-current-indicator-sess_other_conversation')).toBeNull();

        const otherRow = screen.findByTestId('session-list-item-sess_other_conversation');
        if (!otherRow) throw new Error('other session row not found');
        const otherRowContainer = otherRow.parent;
        if (!otherRowContainer) throw new Error('other session row container not found');
        await act(async () => otherRowContainer.props.onPointerEnter({ pointerType: 'mouse' }));
        expect(screen.findByTestId('session-item-current-indicator-sess_current_conversation')).toBe(currentIndicator);
        expect(screen.findByTestId('session-item-current-indicator-sess_other_conversation')).toBeNull();
        await act(async () => otherRowContainer.props.onFocus({ target: {} }));
        expect(screen.findByTestId('session-item-current-indicator-sess_other_conversation')).toBeNull();
        await act(async () => otherRow.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));

        expect(screen.findByTestId('session-item-current-indicator-sess_current_conversation')).toBe(currentIndicator);
        expect(screen.findByTestId('session-item-current-indicator-sess_other_conversation')).toBeNull();
        expect(navigateToSessionSpy).not.toHaveBeenCalled();

        await screen.update(
            <>
                <SessionItem session={currentSession} serverId="server_right_click" selected={false} isFirst variant="default" compact={false} />
                <SessionItem session={otherSession} serverId="server_right_click" selected isLast variant="default" compact={false} />
            </>,
        );
        expect(screen.findByTestId('session-item-current-indicator-sess_current_conversation')).toBeNull();
        expect(screen.findByTestId('session-item-current-indicator-sess_other_conversation')).toBeTruthy();
    });

    it('keeps multi-selected rows checked without presenting them as the open conversation', async () => {
        const session = createSessionFixture({ id: 'sess_multi_selected', active: true, metadata: null });
        const selectionKey = 'server_multi:sess_multi_selected';
        const screen = await renderScreen(
            <SessionListSelectionProvider scopeKey="scope-a" visibleOrderedKeys={[selectionKey]}>
                <SelectForMultiSelection selectionKey={selectionKey} />
                <SessionItem session={session} serverId="server_multi" selectionKey={selectionKey} selected={false} isFirst isLast isSingle variant="default" compact={false} />
            </SessionListSelectionProvider>,
        );
        const control = screen.findByTestId('select-session-for-multi-selection');
        if (!control) throw new Error('multi-selection control not found');
        await act(async () => control.props.onPress());

        expect(screen.findByTestId('session-list-selection-checkbox-sess_multi_selected')?.props.accessibilityState).toMatchObject({ checked: true });
        expect(screen.findByTestId('session-item-current-indicator-sess_multi_selected')).toBeNull();
    });

    it('keeps the current-session marker, title, and action area through compact and minimal density changes', async () => {
        const session = createSessionFixture({
            id: 'sess_selected_density',
            active: true,
            metadata: { name: 'Review the sidebar' } as any,
        });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_density" selected compact variant="default" />,
        );
        const expectSelectedRowContent = () => {
            expect(screen.findByTestId('session-item-current-indicator-sess_selected_density')).toBeTruthy();
            expect(screen.findAllByType('Text').some((node) => node.props.children === 'Session')).toBe(true);
            expect(screen.findByTestId('session-item-right-area')).toBeTruthy();
        };
        expectSelectedRowContent();

        await screen.update(
            <SessionItem session={session} serverId="server_density" selected compact compactMinimal variant="default" />,
        );
        expectSelectedRowContent();
    });

    it('opens the existing row menu without navigating and keeps its action target', async () => {
        const session = createSessionFixture({ id: 'sess_right_click', active: true, metadata: null });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_right_click" selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        const row = screen.findByTestId('session-list-item-sess_right_click');
        if (!row) throw new Error('session row not found');
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        expect(row.props.onContextMenu).toEqual(expect.any(Function));
        await act(async () => row.props.onContextMenu({ preventDefault, stopPropagation }));

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(navigateToSessionSpy).not.toHaveBeenCalled();

        const menu = screen.findByType('DropdownMenu' as React.ElementType);
        expect(menu.props.open).toBe(true);
        expect(menu.props.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: SESSION_ACTION_RENAME_ID })]));
        expect(menu.props.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'session.sameSetup' })]));

        await act(async () => menu.props.onSelect(SESSION_ACTION_RENAME_ID));
        expect(renameSpy).toHaveBeenCalledWith('sess_right_click', 'Renamed', { serverId: 'server_right_click' });
        expect(navigateToSessionSpy).not.toHaveBeenCalled();
    });

    it('uses the same restricted menu for right-click and three-dot, then preserves normal row activation', async () => {
        const session = createSessionFixture({
            id: 'sess_view_only',
            active: true,
            metadata: null,
            accessLevel: 'view',
        });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_view_only" selected={true} isFirst isLast isSingle variant="default" compact={false} />,
        );
        const row = screen.findByTestId('session-list-item-sess_view_only');
        if (!row) throw new Error('session row not found');
        expect(row.props.accessibilityState).toMatchObject({ selected: true });
        const rightArea = screen.findByTestId('session-item-right-area');
        if (!rightArea) throw new Error('session row action area not found');
        await act(async () => rightArea.props.onPointerEnter());
        expect(screen.findByTestId('session-item-same-setup-action')).toBeTruthy();

        await act(async () => row.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
        const menu = screen.findByType('DropdownMenu' as React.ElementType);
        const rightClickItems = menu.props.items;
        expect(menu.props.open).toBe(true);
        expect(rightClickItems).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: SESSION_ACTION_RENAME_ID }),
            expect.objectContaining({ id: 'session.archive' }),
            expect.objectContaining({ id: 'session.stop' }),
        ]));
        expect(rightClickItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'session.sameSetup' })]));

        await act(async () => menu.props.onOpenChange(false));
        const threeDotTrigger = menu.props.trigger({ toggle: () => menu.props.onOpenChange(true) });
        await act(async () => threeDotTrigger.props.onPress({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));

        const reopenedMenu = screen.findByType('DropdownMenu' as React.ElementType);
        expect(reopenedMenu.props.open).toBe(true);
        expect(reopenedMenu.props.items).toEqual(rightClickItems);
        expect(renameSpy).not.toHaveBeenCalled();

        await act(async () => reopenedMenu.props.onOpenChange(false));
        await act(async () => pressTestInstanceAsync(row, 'session list item'));
        expect(navigateToSessionSpy).toHaveBeenCalledWith('sess_view_only', { serverId: 'server_view_only' });
    });

    it('leaves native rows on the long-press path without a web context-menu handler', async () => {
        platformOs = 'ios';
        const session = createSessionFixture({ id: 'sess_native_row', active: true, metadata: null });
        const screen = await renderScreen(
            <SessionItem session={session} selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        const row = screen.findByTestId('session-list-item-sess_native_row');
        if (!row) throw new Error('session row not found');

        expect(row.props.onContextMenu).toBeUndefined();
        expect(row.props.onLongPress).toEqual(expect.any(Function));
    });

    it('opens the same blank draft for the clicked row from plus and right-click without selecting it', async () => {
        const serverId = getActiveServerSnapshot().serverId;
        const session = createSessionFixture({
            id: 'clicked_session', serverId, active: true, encryptionMode: 'plain',
            metadata: {
                path: '/clicked/worktree', machineId: 'clicked-machine', host: 'clicked.local',
                flavor: 'codex', profileId: 'clicked-profile',
            },
        });
        storage.setState({ profileScope: { serverId, accountId: 'active-account' } });
        storage.getState().applySessions([session]);
        const screen = await renderScreen(
            <SessionItem session={session} serverId={serverId} selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        const rightArea = screen.findByTestId('session-item-right-area');
        if (!rightArea) throw new Error('session row action area not found');
        await act(async () => rightArea.props.onPointerEnter());
        const plus = screen.findByTestId('session-item-same-setup-action');
        if (!plus) throw new Error('Same Setup plus action not found');
        await act(async () => plus.props.onPress({ stopPropagation: vi.fn(), preventDefault: vi.fn() }));

        const row = screen.findByTestId('session-list-item-clicked_session');
        if (!row) throw new Error('session row not found');
        await act(async () => row.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
        const menu = screen.findByType('DropdownMenu' as React.ElementType);
        await act(async () => menu.props.onSelect('session.sameSetup'));

        expect(routerPushSpy).toHaveBeenCalledTimes(2);
        for (const [route] of routerPushSpy.mock.calls) {
            expect(route).toEqual({
                pathname: '/new',
                params: expect.objectContaining({
                    machineId: 'clicked-machine', directory: '/clicked/worktree',
                    spawnServerId: serverId, dataId: expect.any(String),
                }),
            });
            const seed = peekTempData<NewSessionData>(route.params.dataId);
            expect(seed).toEqual(expect.objectContaining({
                prompt: '', agentType: 'codex', selectedProfileId: 'clicked-profile',
                replacePersistedDraftSelections: true,
            }));
            expect(seed?.sourceContext).toBeUndefined();
        }
        expect(navigateToSessionSpy).not.toHaveBeenCalled();
    });
});
