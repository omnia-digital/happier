import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { SessionStatus } from '@/utils/sessions/sessionUtils';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import { createSessionItemTestRowModel, installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';
import { SessionListSelectionProvider, useSessionListSelectionActions } from './selection/SessionListSelectionContext';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The session-list row DRAWS the agent-activity sentence it was handed.
 *
 * `buildSessionListRowModel` already pins what the sentence says — it composes through the same
 * owner as the composer chip, so the row and the session it opens onto cannot disagree. Nothing
 * pinned that the row paints it: the render is a pure pass-through of `rowModel.agentActivityLabel`,
 * and deleting the whole `<Text testID="session-list-agent-activity-count-*">` block left every
 * suite green. That is the same false-green shape this corridor already hit at the pane roster and
 * at the run panel — a decision correctly owned and then silently unrendered.
 *
 * So this asserts the join, and only the join: the row model's string reaches a painted node, and
 * an absent string paints nothing. What the string SAYS stays in `buildSessionListRowModel.test.ts`.
 */

type SessionItemProps = Omit<
    React.ComponentProps<(typeof import('./SessionItem'))['SessionItem']>,
    'rowModel'
> & {
    rowModel?: React.ComponentProps<(typeof import('./SessionItem'))['SessionItem']>['rowModel'];
};

vi.mock('react-native-reanimated', () => ({}));
installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web' },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock().module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        const base = await createStorageModuleMock({
            importOriginal,
            overrides: {
                useHasUnreadMessages: () => false,
                useProfile: () => ({
                    id: 'u1',
                    timestamp: 0,
                    firstName: null,
                    lastName: null,
                    username: null,
                    avatar: null,
                    linkedProviders: [],
                    connectedServices: [],
                    connectedServicesV2: [],
                    connectedServiceCredentialRevisionsV1: [],
                }),
                useSession: () => null,
            },
        });
        return {
            ...base,
            useLocalSetting: ((key: keyof LocalSettings) => Object.prototype.hasOwnProperty.call(localPresentationSettings.current, key)
                ? localPresentationSettings.current[key]
                : base.useLocalSetting(key)) as typeof base.useLocalSetting,
            useMachineDisplayIcon: ((serverId?: string | null, machineId?: string | null) =>
                machineIconPreference.current[JSON.stringify([serverId, machineId])] ?? 'desktop') as typeof base.useMachineDisplayIcon,
        };
    },
});
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));
vi.mock('react-native-gesture-handler', () => ({
    Swipeable: 'Swipeable',
}));
vi.mock('@/utils/sessions/sessionUtils', () => ({
    getSessionName: () => 'Session',
    getSessionSubtitle: () => 'Subtitle',
    getSessionAvatarId: () => 'avatar',
    useSessionStatus: () => ({
        isConnected: true,
        statusText: 'Working',
        statusColor: '#000',
        statusDotColor: '#0f0',
        isPulsing: false,
    }),
}));
vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: 'Avatar',
}));
vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: 'AgentIcon',
}));
vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));
vi.mock('@/hooks/session/useNavigateToSession', () => ({
    useNavigateToSession: () => vi.fn(),
}));
vi.mock('@/utils/platform/responsive', () => ({
    useIsTablet: () => false,
}));
vi.mock('@/hooks/ui/useHappyAction', () => ({
    useHappyAction: (_fn: unknown) => [false, vi.fn()],
}));
vi.mock('@/sync/ops', async (importOriginal) => {
    const { createSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
    return createSyncOpsModuleMock({
        importOriginal,
        overrides: {
            sessionStopWithServerScope: vi.fn(async () => ({ success: true })),
            sessionArchiveWithServerScope: vi.fn(async () => ({ success: true })),
        },
    });
});
vi.mock('./sessionPinIcons', () => ({
    PinIcon: (props: Record<string, unknown>) => React.createElement('PinIcon', props),
    PinSlashIcon: (props: Record<string, unknown>) => React.createElement('PinSlashIcon', props),
}));

const SESSION_ID = 'sess_machine';
const machineIconPreference = vi.hoisted(() => ({ current: {} as Record<string, 'laptop' | 'cloud'> }));
const localPresentationSettings = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

function SelectionModeControls() {
    const actions = useSessionListSelectionActions();
    return React.createElement('SelectionModeControls', {
        testID: 'enter-selection-mode',
        onPress: () => actions.enter(),
    });
}

describe('SessionItem machine identity', () => {
    afterEach(() => {
        localPresentationSettings.current = {};
        standardCleanup();
    });

    const session = {
        id: SESSION_ID, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: { name: 'Review', machineId: 'machine-a' }, metadataVersion: 1,
        agentState: null, agentStateVersion: 1, thinking: false, thinkingAt: 0, presence: 'online',
    } as any;

    async function renderMachineRow(
        showMachineIdentity: boolean,
        showMachineLabel = true,
        options: Readonly<{ density?: 'default' | 'compact' | 'minimal'; pinned?: boolean; identityDisplay?: 'avatar' | 'agentLogo' | 'none' }> = {},
    ) {
        const { SessionItem } = await import('./SessionItem');
        const density = options.density ?? 'minimal';
        const props: SessionItemProps = {
            session, serverId: 'server-a', compact: density !== 'default', compactMinimal: density === 'minimal',
            pinned: options.pinned ?? true, variant: 'no-path',
        };
        return renderScreen(<SessionItem {...props} rowModel={createSessionItemTestRowModel(props, {
            machineLabel: 'Long named studio workstation', machineId: 'machine-a', showMachineIdentity, showMachineLabel,
            title: 'Review', isPinned: options.pinned ?? true,
            identityDisplay: options.identityDisplay ?? 'agentLogo',
        })} />);
    }

    it('uses app item density for row spacing and grows row geometry for larger text', async () => {
        const rowHeight = async (density: 'comfortable' | 'cozy' | 'compact', fontScale: number) => {
            localPresentationSettings.current = { uiItemDensity: density, uiFontScale: fontScale };
            const screen = await renderMachineRow(false, false, { density: 'compact' });
            const style = screen.findByTestId(`session-list-item-${SESSION_ID}`)?.props.style;
            const flattened = Array.isArray(style) ? style.flat(Infinity) : [style];
            const height = flattened.reduce((lastHeight: number | undefined, entry: any) => (
                typeof entry?.height === 'number' ? entry.height : lastHeight
            ), undefined);
            await screen.unmount();
            return height;
        };

        const comfortableHeight = await rowHeight('comfortable', 1);
        const compactHeight = await rowHeight('compact', 1);
        const largerTextHeight = await rowHeight('compact', 1.3);

        const narrowRowHeight = async (density: 'cozy' | 'compact') => {
            localPresentationSettings.current = { uiItemDensity: density, uiFontScale: 1 };
            const screen = await renderMachineRow(false, false, { density: 'minimal' });
            const style = screen.findByTestId(`session-list-item-${SESSION_ID}`)?.props.style;
            const flattened = Array.isArray(style) ? style.flat(Infinity) : [style];
            const height = flattened.reduce((lastHeight: number | undefined, entry: any) => (
                typeof entry?.height === 'number' ? entry.height : lastHeight
            ), undefined);
            await screen.unmount();
            return height;
        };
        const narrowCozyHeight = await narrowRowHeight('cozy');
        const narrowCompactHeight = await narrowRowHeight('compact');

        expect(comfortableHeight).toBeGreaterThan(compactHeight);
        expect(largerTextHeight).toBeGreaterThan(compactHeight);
        expect(narrowCozyHeight).toBeGreaterThan(narrowCompactHeight);
        expect(narrowCompactHeight).toBeGreaterThanOrEqual(34);
    });

    it('places one agent logo immediately before the machine glyph in the right identity group', async () => {
        const screen = await renderMachineRow(true);
        const rightGroup = screen.findByTestId(`session-list-right-identity-${SESSION_ID}`);
        expect(rightGroup).not.toBeNull();
        const agent = rightGroup?.findAllByType('AgentIcon' as never) ?? [];
        expect(agent).toHaveLength(1);
        expect(rightGroup?.children).toHaveLength(2);
        expect((rightGroup?.children[0] as { findAllByType: (type: never) => unknown[] })
            ?.findAllByType('AgentIcon' as never)).toHaveLength(1);
        expect((rightGroup?.children[1] as { props?: { testID?: string } })?.props?.testID)
            .toBe(`session-list-machine-identity-${SESSION_ID}`);
        expect(screen.root.findAllByType('AgentIcon' as never)).toHaveLength(1);
    });

    it.each(['default', 'compact', 'minimal'] as const)(
        'keeps the agent and machine on ordinary %s cards without another leading logo',
        async (density) => {
            const screen = await renderMachineRow(true, true, { density, pinned: false });
            const group = screen.findByTestId(`session-list-right-identity-${SESSION_ID}`);
            expect(group?.children).toHaveLength(2);
            expect(screen.root.findAllByType('AgentIcon' as never)).toHaveLength(1);
            expect(screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`)).not.toBeNull();
        },
    );

    it('keeps avatar and hidden-identity choices independent of the machine label preference', async () => {
        const avatar = await renderMachineRow(true, false, { identityDisplay: 'avatar' });
        expect(avatar.root.findAllByType('Avatar' as never)).toHaveLength(1);
        expect(avatar.root.findAllByType('AgentIcon' as never)).toHaveLength(0);
        expect(avatar.findByTestId(`session-list-machine-identity-${SESSION_ID}`)?.findAllByType('Text' as never)).toHaveLength(0);
        await avatar.unmount();

        const hidden = await renderMachineRow(true, true, { identityDisplay: 'none' });
        expect(hidden.root.findAllByType('Avatar' as never)).toHaveLength(0);
        expect(hidden.root.findAllByType('AgentIcon' as never)).toHaveLength(0);
        expect(hidden.findByTestId(`session-list-machine-identity-${SESSION_ID}`)).not.toBeNull();
    });

    it('keeps the selection checkbox in its leading slot and removes the agent logo during selection', async () => {
        const { SessionItem } = await import('./SessionItem');
        const selectionKey = `server-a:${SESSION_ID}`;
        const props: SessionItemProps = {
            session, serverId: 'server-a', selectionKey, compact: true, compactMinimal: true,
            pinned: true, variant: 'no-path',
        };
        const screen = await renderScreen(
            <SessionListSelectionProvider scopeKey="scope-a" visibleOrderedKeys={[selectionKey]}>
                <SelectionModeControls />
                <SessionItem {...props} rowModel={createSessionItemTestRowModel(props, {
                    machineLabel: 'Studio Mac', machineId: 'machine-a', identityDisplay: 'agentLogo',
                })} />
            </SessionListSelectionProvider>,
        );
        expect(screen.root.findAllByType('AgentIcon' as never)).toHaveLength(1);
        await act(async () => screen.findByTestId('enter-selection-mode')?.props.onPress());
        expect(screen.findByTestId(`session-list-selection-checkbox-${SESSION_ID}`)).not.toBeNull();
        expect(screen.root.findAllByType('AgentIcon' as never)).toHaveLength(0);
        expect(screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`)).not.toBeNull();
    });

    it('shows a readable machine name with full accessible identity on compact Pinned rows', async () => {
        const screen = await renderMachineRow(true);
        const indicator = screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`);
        expect(indicator).not.toBeNull();
        expect(indicator?.props.accessibilityLabel).toBe('Long named studio workstation');
        expect(indicator?.findAllByType('Text' as never).some(node => node.props.children === 'Long named studio workstation')).toBe(true);
        expect(screen.getTextContent()).toContain('Review');
    });

    it('renders the machine-specific icon with the shared identity glyph', async () => {
        machineIconPreference.current = { '["server-a","machine-a"]': 'laptop' };
        try {
            const screen = await renderMachineRow(true);
            const indicator = screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`);
            const { Icon } = await import('@/components/ui/icons/Icon');
            expect(indicator?.findAllByType(Icon as never).some(node => node.props.name === 'laptop')).toBe(true);
        } finally {
            machineIconPreference.current = {};
        }
    });

    it('keeps equal-label machine group icons scoped to their server', async () => {
        machineIconPreference.current = {
            '["server-a","machine-a"]': 'laptop',
            '["server-b","machine-a"]': 'cloud',
        };
        try {
            const { CollapsibleSectionHeader } = await import('./CollapsibleSectionHeader');
            const { Icon } = await import('@/components/ui/icons/Icon');
            const props = {
                title: 'Studio Mac', headerKind: 'machine' as const, machineId: 'machine-a',
                collapsed: false, onPress: vi.fn(), headerTestId: 'machine-group',
            };
            const screen = await renderScreen(<CollapsibleSectionHeader {...props} serverId="server-a" />);
            expect(screen.root.findAllByType(Icon as never).some(node => node.props.name === 'laptop')).toBe(true);
            await screen.update(<CollapsibleSectionHeader {...props} serverId="server-b" />);
            expect(screen.root.findAllByType(Icon as never).some(node => node.props.name === 'cloud')).toBe(true);
        } finally {
            machineIconPreference.current = {};
        }
    });

    it('omits only the machine indicator when the local preference is off', async () => {
        const screen = await renderMachineRow(false);
        expect(screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`)).toBeNull();
        expect(screen.getTextContent()).toContain('Review');
    });

    it('keeps the chosen glyph, accessible full name, and hover/focus tooltip when only the label is off', async () => {
        machineIconPreference.current = { '["server-a","machine-a"]': 'laptop' };
        try {
            const screen = await renderMachineRow(true, false);
            const indicator = screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`);
            const { Icon } = await import('@/components/ui/icons/Icon');
            expect(indicator?.props.accessibilityLabel).toBe('Long named studio workstation');
            expect(indicator?.findAllByType(Icon as never).some(node => node.props.name === 'laptop')).toBe(true);
            expect(indicator?.findAllByType('Text' as never)).toHaveLength(0);
            await act(async () => indicator?.props.onPointerEnter());
            expect(screen.root.findAll((node) => node.props?.label === 'Long named studio workstation').length).toBeGreaterThan(0);
            await act(async () => indicator?.props.onPointerLeave());
            expect(typeof indicator?.props.onFocus).toBe('function');
            await act(async () => indicator?.props.onFocus());
            expect(screen.root.findAll((node) => node.props?.label === 'Long named studio workstation').length).toBeGreaterThan(0);
        } finally {
            machineIconPreference.current = {};
        }
    });

    it('opens the full machine name through the web tooltip on hover', async () => {
        const screen = await renderMachineRow(true);
        const indicator = screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`);
        expect(typeof indicator?.props.onPointerEnter).toBe('function');
        await act(async () => indicator?.props.onPointerEnter());
        const tooltip = screen.root.findAll((node) => node.props?.label === 'Long named studio workstation');
        expect(tooltip.length).toBeGreaterThan(0);
    });
});
