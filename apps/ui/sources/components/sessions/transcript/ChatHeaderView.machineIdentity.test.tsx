import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createExpoVectorIconsMock,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { installTranscriptCommonModuleMocks, resetTranscriptCommonModuleMockState } from './transcriptTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let platformOs: 'ios' | 'android' | 'web' = 'ios';
const headerMocks = vi.hoisted(() => ({
    identityMode: 'avatar' as 'avatar' | 'agentLogo' | 'none',
}));

installTranscriptCommonModuleMocks({
    // Only this one key is steered; every other setting still resolves through the real module, or
    // the rest of the tree renders against undefined and the suite falls over.
    storage: async (importOriginal: <T>() => Promise<T>) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        const base = await createPartialStorageModuleMock(importOriginal, {});
        return {
            ...base,
            useSetting: ((key: string) => (key === 'sessionHeaderIdentityDisplay'
                ? headerMocks.identityMode
                : (base.useSetting as (k: string) => unknown)(key))) as typeof base.useSetting,
        };
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                get OS() {
                    return platformOs;
                },
                select: (values: any) => values?.[platformOs] ?? values?.default ?? null,
            },
            View: 'View',
            Text: 'Text',
            Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    header: { background: '#fff', tint: '#111' },
                    surface: '#fff',
                    surfaceHigh: '#f5f5f5',
                    divider: '#ddd',
                    textSecondary: '#666',
                    shadow: { color: '#000', opacity: 0.2 },
                },
            },
        });
    },
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ goBack: vi.fn() }),
}));

vi.mock('@/utils/platform/responsive', () => ({
    useHeaderHeight: () => 44,
}));

vi.mock('@expo/vector-icons', async () => createExpoVectorIconsMock());

vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: (props: any) => React.createElement('Avatar', props),
}));

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: any) => React.createElement('AgentIcon', props),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
    },
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { headerMaxWidth: 1024 },
    useLayoutMaxWidth: () => 1024,
}));

describe('ChatHeaderView machine identity', () => {
    afterEach(() => {
        platformOs = 'ios';
        headerMocks.identityMode = 'avatar';
        standardCleanup();
        resetTranscriptCommonModuleMockState();
    });

    it('shows the resolved machine next to the title and updates it when sessions switch', async () => {
        const { ChatHeaderView } = await import('./ChatHeaderView');
        const screen = await renderScreen(<ChatHeaderView title="First session" subtitle="project" badges={['Persisted']} machineLabel="Studio Mac" />);
        const first = screen.findByTestId('session-header-machine-identity');
        expect(first?.props.accessibilityLabel).toBe('Studio Mac');
        expect(screen.getTextContent()).toContain('First session');
        expect(screen.getTextContent()).toContain('project');
        expect(screen.getTextContent()).toContain('Persisted');

        await screen.update(<ChatHeaderView title="Second session" subtitle="other project" badges={['Persisted']} machineLabel="Long named build workstation" />);
        expect(screen.findByTestId('session-header-machine-identity')?.props.accessibilityLabel).toBe('Long named build workstation');
        expect(screen.getTextContent()).not.toContain('Studio Mac');
        expect(screen.getTextContent()).toContain('other project');
    });

    it('keeps the full machine name accessible when a long label is visually truncated', async () => {
        const { ChatHeaderView } = await import('./ChatHeaderView');
        const screen = await renderScreen(<ChatHeaderView title="Title" machineLabel="Long named build workstation" />);
        const label = screen.findByTestId('session-header-machine-identity');
        expect(label?.props.accessibilityLabel).toBe('Long named build workstation');
        expect(label?.findAllByType('Text' as never).some(node => node.props.numberOfLines === 1 && node.props.children === 'Long named build workstation')).toBe(true);
    });
});
