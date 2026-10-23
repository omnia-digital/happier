import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { SessionStatus } from '@/utils/sessions/sessionUtils';
import { createSessionItemTestRowModel, installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

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
        return createStorageModuleMock({
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

describe('SessionItem machine identity', () => {
    afterEach(standardCleanup);

    const session = {
        id: SESSION_ID, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: { name: 'Review', machineId: 'machine-a' }, metadataVersion: 1,
        agentState: null, agentStateVersion: 1, thinking: false, thinkingAt: 0, presence: 'online',
    } as any;

    async function renderMachineRow(showMachineIdentity: boolean) {
        const { SessionItem } = await import('./SessionItem');
        const props: SessionItemProps = {
            session, serverId: 'server-a', compact: true, compactMinimal: true,
            pinned: true, variant: 'no-path',
        };
        return renderScreen(<SessionItem {...props} rowModel={createSessionItemTestRowModel(props, {
            machineLabel: 'Long named studio workstation', showMachineIdentity,
            title: 'Review', isPinned: true,
        })} />);
    }

    it('shows a readable machine name with full accessible identity on compact Pinned rows', async () => {
        const screen = await renderMachineRow(true);
        const indicator = screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`);
        expect(indicator).not.toBeNull();
        expect(indicator?.props.accessibilityLabel).toBe('Long named studio workstation');
        expect(indicator?.findAllByType('Text' as never).some(node => node.props.children === 'Long named studio workstation')).toBe(true);
        expect(screen.getTextContent()).toContain('Review');
    });

    it('omits only the machine indicator when the local preference is off', async () => {
        const screen = await renderMachineRow(false);
        expect(screen.findByTestId(`session-list-machine-identity-${SESSION_ID}`)).toBeNull();
        expect(screen.getTextContent()).toContain('Review');
    });
});
