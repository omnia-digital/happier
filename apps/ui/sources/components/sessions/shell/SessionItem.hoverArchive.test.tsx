import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDeferred, createSessionFixture, pressTestInstanceAsync, renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionItemTestRowModel, installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import { SESSION_ACTION_ARCHIVE_ID } from '@/components/sessions/actions/sessionActionIds';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    const { View, Text, ScrollView } = await import('react-native');
    const mock = createReanimatedModuleMock();
    return { ...mock, default: { ...mock.default, View, Text, ScrollView }, View, Text, ScrollView };
});
vi.mock('react-native-gesture-handler', () => ({ Swipeable: 'Swipeable' }));
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
const navigateToSessionSpy = vi.fn();
vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => navigateToSessionSpy }));

const archiveSpy = vi.fn(async () => ({ success: true, archivedAt: 1 }));
const stopSpy = vi.fn(async () => ({ success: true }));
vi.mock('@/sync/ops', async (importOriginal) => {
    const { createSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
    return createSyncOpsModuleMock({ importOriginal, overrides: {
        sessionArchiveWithServerScope: archiveSpy,
        sessionStopWithServerScope: stopSpy,
    } });
});
const modalConfirmSpy = vi.fn(async () => true);
installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { OS: 'web' } });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ confirmResult: true, spies: { confirm: modalConfirmSpy } }).module;
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
    const { SessionItem: ProductionSessionItem } = await import('./SessionItem');
    SessionItem = (props) => <ProductionSessionItem {...props} rowModel={props.rowModel ?? createSessionItemTestRowModel(props)} />;
});

afterEach(() => {
    standardCleanup();
    archiveSpy.mockClear();
    stopSpy.mockClear();
    modalConfirmSpy.mockReset();
    modalConfirmSpy.mockResolvedValue(true);
    navigateToSessionSpy.mockClear();
});

async function revealRowActions(screen: Awaited<ReturnType<typeof renderScreen>>, sessionId: string) {
    const row = screen.findByTestId(`session-list-item-${sessionId}`);
    if (!row?.parent) throw new Error('session row container not found');
    await act(async () => row.parent?.props.onPointerEnter?.());
    return row;
}

describe('SessionItem hover Archive action (web)', () => {
    it('publishes only the eligible pointer-hovered target and clears it on leave and unmount', async () => {
        const onHoverArchiveTarget = vi.fn();
        const session = createSessionFixture({ id: 'sess_hover_target', active: false, metadata: null });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_hover_target" selected={false}
                isFirst isLast isSingle variant="default" compact={false}
                onHoverArchiveTarget={onHoverArchiveTarget} />,
        );
        const row = await revealRowActions(screen, session.id);
        expect(onHoverArchiveTarget).toHaveBeenCalledWith('server_hover_target:sess_hover_target', expect.objectContaining({
            sessionId: session.id,
            serverId: 'server_hover_target',
            canArchive: true,
        }));
        await act(async () => row.parent?.props.onPointerLeave?.());
        expect(onHoverArchiveTarget).toHaveBeenLastCalledWith('server_hover_target:sess_hover_target', null);
        await act(async () => row.parent?.props.onPointerEnter?.());
        await act(async () => screen.tree.unmount());
        expect(onHoverArchiveTarget).toHaveBeenLastCalledWith('server_hover_target:sess_hover_target', null);
    });
    it('shows an accessible Archive action with existing controls and archives the inactive row on its server', async () => {
        const session = createSessionFixture({ id: 'sess_hover_archive', active: false, metadata: null });
        const screen = await renderScreen(
            <SessionItem
                session={session}
                serverId="server_archive_target"
                selected={false}
                isFirst
                isLast
                isSingle
                variant="default"
                compact={false}
                onTogglePinned={vi.fn()}
                tagsEnabled
                tags={[]}
                allKnownTags={[]}
                onSetTags={vi.fn()}
            />,
        );
        const row = await revealRowActions(screen, session.id);

        const archiveButton = screen.findByTestId('session-item-archive-action');
        expect(archiveButton).toBeTruthy();
        expect(archiveButton?.props).toMatchObject({
            accessibilityRole: 'button',
            accessibilityLabel: 'sessionInfo.archiveSession',
            disabled: false,
        });
        expect(archiveButton?.props.onHoverIn).toEqual(expect.any(Function));
        expect(screen.findByTestId('session-item-tag-action')).toBeTruthy();
        expect(screen.findAllByProps({ accessibilityLabel: 'sessionInfo.pinSession' })).toHaveLength(1);
        expect(screen.findByTestId('session-item-more-menu')).toBeTruthy();

        await pressTestInstanceAsync(archiveButton, 'Archive session');
        await vi.waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(
            'sess_hover_archive',
            { serverId: 'server_archive_target' },
        ));
        expect(stopSpy).not.toHaveBeenCalled();
        expect(navigateToSessionSpy).not.toHaveBeenCalled();
        expect(row.props.testID).toBe('session-list-item-sess_hover_archive');
    });

    it('keeps the active-session stop safeguard and omits Archive for restricted or archived rows', async () => {
        const activeSession = createSessionFixture({ id: 'sess_active_hover_archive', active: true, metadata: null });
        const activeScreen = await renderScreen(
            <SessionItem session={activeSession} serverId="server_active_archive" selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        await revealRowActions(activeScreen, activeSession.id);
        const activeArchiveButton = activeScreen.findByTestId('session-item-archive-action');
        expect(activeArchiveButton).toBeTruthy();
        await pressTestInstanceAsync(activeArchiveButton, 'Archive active session');
        await vi.waitFor(() => expect(archiveSpy).toHaveBeenCalledWith(
            'sess_active_hover_archive',
            { serverId: 'server_active_archive', signal: expect.any(AbortSignal) },
        ));
        expect(modalConfirmSpy).toHaveBeenCalledWith(
            'sessionInfo.stopSession',
            'sessionInfo.stopSessionConfirm',
            expect.any(Object),
        );
        expect(stopSpy).toHaveBeenCalledWith('sess_active_hover_archive', { serverId: 'server_active_archive' });
        expect(navigateToSessionSpy).not.toHaveBeenCalled();
        standardCleanup();

        const restricted = createSessionFixture({ id: 'sess_restricted_archive', active: false, accessLevel: 'view', metadata: null });
        const restrictedScreen = await renderScreen(
            <SessionItem session={restricted} selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        await revealRowActions(restrictedScreen, restricted.id);
        expect(restrictedScreen.findByTestId('session-item-archive-action')).toBeNull();
        standardCleanup();

        const archived = createSessionFixture({ id: 'sess_archived_row', active: false, archivedAt: 1, metadata: null });
        const archivedScreen = await renderScreen(
            <SessionItem session={archived} selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        await revealRowActions(archivedScreen, archived.id);
        expect(archivedScreen.findByTestId('session-item-archive-action')).toBeNull();
    });

    it('shows the keyboard-reachable action on row focus and disables repeat activation while archiving', async () => {
        const archiveDeferred = createDeferred<{ success: true; archivedAt: number }>();
        const onHoverArchiveTarget = vi.fn();
        archiveSpy.mockImplementation(async () => archiveDeferred.promise);
        const session = createSessionFixture({ id: 'sess_archive_busy', active: false, metadata: null });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_busy_archive" selected={false} isFirst isLast isSingle variant="default" compact={false} onHoverArchiveTarget={onHoverArchiveTarget} />,
        );
        const row = screen.findByTestId('session-list-item-sess_archive_busy');
        if (!row?.parent) throw new Error('session row container not found');
        await act(async () => row.parent?.props.onFocus?.({}));
        await act(async () => row.parent?.props.onPointerEnter?.());
        expect(onHoverArchiveTarget).toHaveBeenCalledWith('server_busy_archive:sess_archive_busy', expect.objectContaining({ canArchive: true }));

        const archiveButton = screen.findByTestId('session-item-archive-action');
        expect(archiveButton).toBeTruthy();
        expect(archiveButton?.props.accessibilityRole).toBe('button');
        expect(archiveButton?.props.accessibilityLabel).toBe('sessionInfo.archiveSession');

        await pressTestInstanceAsync(archiveButton, 'Archive session');
        await vi.waitFor(() => expect(archiveSpy).toHaveBeenCalledTimes(1));
        const busyButton = screen.findByTestId('session-item-archive-action');
        expect(busyButton?.props.disabled).toBe(true);
        expect(onHoverArchiveTarget).toHaveBeenLastCalledWith('server_busy_archive:sess_archive_busy', null);
        await pressTestInstanceAsync(busyButton, 'Archive session while busy');
        expect(archiveSpy).toHaveBeenCalledTimes(1);
        expect(navigateToSessionSpy).not.toHaveBeenCalled();

        await act(async () => archiveDeferred.resolve({ success: true, archivedAt: 1 }));
        await vi.waitFor(() => expect(screen.findByTestId('session-item-archive-action')?.props.disabled).toBe(false));
        expect(archiveSpy).toHaveBeenCalledTimes(1);
    });
});
