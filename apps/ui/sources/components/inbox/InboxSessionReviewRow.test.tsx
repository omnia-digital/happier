import * as React from 'react';
import renderer from 'react-test-renderer';
import { Platform } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { createSessionFixture, renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const base = await createReactNativeWebMock({
        Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        View: 'View',
    });
    return {
        ...base,
        Platform: {
            OS: 'ios',
            select: (choices: Record<string, unknown>) => choices.ios ?? choices.default,
        },
    };
});

vi.mock('react-native-gesture-handler', () => ({
    Swipeable: React.forwardRef(({ children, ...props }: any, _ref) => (
        React.createElement('Swipeable', props, children)
    )),
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/components/ui/buttons/IconAction', () => ({ IconAction: 'IconAction' }));
vi.mock('@/components/sessions/shell/SessionListIdentity', () => ({ SessionListIdentity: 'SessionListIdentity' }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

function useWebPlatformForTest(): () => void {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    return () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    };
}

describe('InboxSessionReviewRow', () => {
    const session = createSessionFixture({
        id: 'session-1',
        metadata: { path: '/repo', flavor: 'codex' } as ReturnType<typeof createSessionFixture>['metadata'],
    });

    it('uses the canonical session-list identity with the selected provider-logo mode', async () => {
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                onOpen={() => {}}
            />,
        )).tree;

        const item = tree.root.findByType('Item');
        const identity = item.props.leftElement as React.ReactElement<{
            session: typeof session;
            display: string;
        }>;
        expect(identity.type).toBe('SessionListIdentity');
        expect(identity.props.session).toBe(session);
        expect(identity.props.display).toBe('agentLogo');
        expect(item.props).toMatchObject({
            density: 'compact',
        });
    });

    it('removes the entire leading slot when the session-list identity setting is none', async () => {
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="none"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                onOpen={() => {}}
            />,
        )).tree;

        const item = tree.root.findByType('Item');
        expect(item.props.leftElement).toBeUndefined();
        expect(item.props.iconBoxSize).toBeUndefined();
        expect(tree.root.findAllByType('SessionListIdentity')).toHaveLength(0);
    });

    it('exposes a native swipe action that marks only that session as read', async () => {
        const onMarkRead = vi.fn(async () => {});
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                pending={false}
                onOpen={() => {}}
                onMarkRead={onMarkRead}
            />,
        )).tree;

        const swipeable = tree.root.findByType('Swipeable');
        let action!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            action = renderer.create(swipeable.props.renderRightActions());
        });
        await renderer.act(async () => {
            action.root.findByType('Pressable').props.onPress();
        });

        expect(onMarkRead).toHaveBeenCalledOnce();
    });

    it('sizes the native swipe action as a labelled button with a 48pt minimum target', async () => {
        const onMarkRead = vi.fn(async () => {});
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                pending={false}
                onOpen={() => {}}
                onMarkRead={onMarkRead}
            />,
        )).tree;

        const swipeable = tree.root.findByType('Swipeable');
        let action!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            action = renderer.create(swipeable.props.renderRightActions());
        });
        const pressable = action.root.findByType('Pressable');

        expect(pressable.props.accessibilityRole).toBe('button');
        expect(pressable.props.accessibilityLabel).toBe('sessionInfo.markSessionRead');

        const style = pressable.props.style(false);
        const flatStyle = Array.isArray(style) ? style : [style];
        const minHeight = flatStyle.reduce((minimum: number, entry: unknown) => (
            entry && typeof entry === 'object' && typeof (entry as { minHeight?: unknown }).minHeight === 'number'
                ? Math.max(minimum, (entry as { minHeight: number }).minHeight)
                : minimum
        ), 0);
        expect(minHeight).toBeGreaterThanOrEqual(48);
    });

    it('exposes mark read as a screen-reader action without duplicating the callback', async () => {
        const onMarkRead = vi.fn(async () => {});
        const onOpen = vi.fn();
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                pending={false}
                onOpen={onOpen}
                onMarkRead={onMarkRead}
            />,
        )).tree;

        const accessibilityOwner = tree.root.findByType('Item');
        expect(accessibilityOwner.props.testID).toBe('inbox.review_session.server-a.session-1');
        expect(accessibilityOwner.props.accessibilityLabel).toBe('Ready for review: Review session');
        expect(accessibilityOwner.props.onPress).toBe(onOpen);
        expect(accessibilityOwner.props.accessibilityActions).toEqual([
            { name: 'markRead', label: 'sessionInfo.markSessionRead' },
        ]);
        accessibilityOwner.props.onPress();
        await renderer.act(async () => {
            accessibilityOwner.props.onAccessibilityAction({ nativeEvent: { actionName: 'markRead' } });
        });

        expect(onOpen).toHaveBeenCalledOnce();
        expect(onMarkRead).toHaveBeenCalledOnce();
    });

    it('withdraws the screen-reader mark-read shortcut while a mark is already in flight', async () => {
        const onMarkRead = vi.fn(async () => {});
        const onOpen = vi.fn();
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-1"
                serverId="server-a"
                title="Review session"
                statusLabel="Ready for review"
                pending={true}
                onOpen={onOpen}
                onMarkRead={onMarkRead}
            />,
        )).tree;

        const item = tree.root.findByType('Item');
        expect(item.props.accessibilityActions).toEqual([]);
        expect(item.props.onAccessibilityAction).toBeUndefined();
        expect(item.props.accessibilityState).toEqual({ busy: true });
        expect(item.props.disabled).not.toBe(true);
        item.props.onPress();
        expect(onOpen).toHaveBeenCalledOnce();

        const swipeable = tree.root.findByType('Swipeable');
        let action!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            action = renderer.create(swipeable.props.renderRightActions());
        });
        const pressable = action.root.findByType('Pressable');
        expect(pressable.props.disabled).toBe(true);
        await renderer.act(async () => {
            pressable.props.onPress();
        });
        expect(onMarkRead).not.toHaveBeenCalled();
    });

    it('offers a keyboard-accessible web mark-read control through the same callback', async () => {
        const restorePlatform = useWebPlatformForTest();
        try {
            const onMarkRead = vi.fn(async () => {});
            const onOpen = vi.fn();
            const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
            const tree = (await renderScreen(
                <InboxSessionReviewRow
                    session={session}
                    identityDisplay="agentLogo"
                    sessionId="session-1"
                    serverId="server-a"
                    title="Review session"
                    statusLabel="Ready for review"
                    pending={false}
                    onOpen={onOpen}
                    onMarkRead={onMarkRead}
                />,
            )).tree;

            const item = tree.root.findByType('Item');
            expect(item.props.rightElementOutsidePressable).toBe(true);
            const action = item.props.rightElement as React.ReactElement<any>;
            expect(action.type).toBe('IconAction');
            expect(action.props.accessibilityRole).toBe('button');
            expect(action.props.accessibilityLabel).toBe('sessionInfo.markSessionRead');
            const stopPropagation = vi.fn();
            await renderer.act(async () => {
                action.props.onPress({ stopPropagation });
            });

            // The control is a sibling of the row pressable; its own event still stops
            // propagation so container-level handlers cannot also open the session.
            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(onOpen).not.toHaveBeenCalled();
            expect(onMarkRead).toHaveBeenCalledOnce();
        } finally {
            restorePlatform();
        }
    });

    it('keeps the web mark-read control present, labelled, and busy while a mark is in flight', async () => {
        const restorePlatform = useWebPlatformForTest();
        try {
            const onMarkRead = vi.fn(async () => {});
            const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
            const tree = (await renderScreen(
                <InboxSessionReviewRow
                    session={session}
                    identityDisplay="agentLogo"
                    sessionId="session-1"
                    serverId="server-a"
                    title="Review session"
                    statusLabel="Ready for review"
                    pending={true}
                    onOpen={() => {}}
                    onMarkRead={onMarkRead}
                />,
            )).tree;

            const item = tree.root.findByType('Item');
            const action = item.props.rightElement as React.ReactElement<any>;
            expect(action.type).toBe('IconAction');
            expect(action.props.accessibilityRole).toBe('button');
            expect(action.props.accessibilityLabel).toBe('sessionInfo.markSessionRead');
            expect(action.props.disabled).toBe(true);
            expect(action.props.accessibilityState).toMatchObject({ busy: true });
            expect((action.props.children as React.ReactElement).type).toBe('ActivitySpinner');

            await renderer.act(async () => {
                action.props.onPress({ stopPropagation: vi.fn() });
            });
            expect(onMarkRead).not.toHaveBeenCalled();
        } finally {
            restorePlatform();
        }
    });

    it('keeps a failed review row actionable when there is no read target', async () => {
        const onOpen = vi.fn();
        const { InboxSessionReviewRow } = await import('./InboxSessionReviewRow');
        const tree = (await renderScreen(
            <InboxSessionReviewRow
                session={session}
                identityDisplay="agentLogo"
                sessionId="session-failed"
                serverId="server-a"
                title="Failed session"
                statusLabel="Error"
                onOpen={onOpen}
            />,
        )).tree;

        const item = tree.root.findByType('Item');
        expect(item.props.testID).toBe('inbox.review_session.server-a.session-failed');
        expect(item.props.density).toBe('compact');
        expect(item.props.detail).toBeUndefined();
        expect(item.props.rightElement).toBeNull();
        expect(tree.root.findAllByType('Swipeable')).toHaveLength(0);
        item.props.onPress();
        expect(onOpen).toHaveBeenCalledOnce();
    });
});
