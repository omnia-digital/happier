import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionItemTestRowModel, installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import { SESSION_ACTION_RENAME_ID } from '@/components/sessions/actions/sessionActionIds';

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
vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => navigateToSessionSpy }));
const renameSpy = vi.fn(async () => ({ success: true }));
vi.mock('@/sync/ops', async (importOriginal) => {
    const { createSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
    return createSyncOpsModuleMock({ importOriginal, overrides: { sessionRename: renameSpy } });
});
const promptSpy = vi.fn(async () => 'Renamed');
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
    const { SessionItem: ProductionSessionItem } = await import('./SessionItem');
    SessionItem = (props) => <ProductionSessionItem {...props} rowModel={props.rowModel ?? createSessionItemTestRowModel(props)} />;
});

afterEach(() => {
    standardCleanup();
    navigateToSessionSpy.mockClear();
    renameSpy.mockClear();
    promptSpy.mockReset();
    promptSpy.mockResolvedValue('Renamed');
});

describe('SessionItem right-click menu (web)', () => {
    it('opens the existing row menu without navigating and keeps its action target', async () => {
        const session = createSessionFixture({ id: 'sess_right_click', active: true, metadata: null });
        const screen = await renderScreen(
            <SessionItem session={session} serverId="server_right_click" selected={false} isFirst isLast isSingle variant="default" compact={false} />,
        );
        const row = screen.findByTestId('session-list-item-sess_right_click');
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

        await act(async () => menu.props.onSelect(SESSION_ACTION_RENAME_ID));
        expect(renameSpy).toHaveBeenCalledWith('sess_right_click', 'Renamed', { serverId: 'server_right_click' });
        expect(navigateToSessionSpy).not.toHaveBeenCalled();
    });
});
