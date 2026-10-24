import * as React from 'react';
import { View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

function resolvePressableStyle(style: unknown): unknown {
    if (typeof style !== 'function') return style;
    return (style as (state: { pressed: boolean; hovered: boolean }) => unknown)({ pressed: false, hovered: false });
}

function readOpacity(style: unknown): number | undefined {
    const opacity = flattenStyle(style).opacity;
    if (typeof opacity === 'number') return opacity;
    const animated = opacity as { __getValue?: () => number } | undefined;
    return typeof animated?.__getValue === 'function' ? animated.__getValue() : undefined;
}

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('Text', props, props.children),
}));

describe('MessageActionRow', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('renders timestamp and action slot with stable row test ids', async () => {
        const { MessageActionRow } = await import('./MessageActionRow');

        const screen = await renderScreen(
            <MessageActionRow
                messageId="m1"
                timestampText="May 19, 2026, 4:30 PM"
                showActions
                isWeb
                invertTimestampAndActions={false}
            >
                <View testID="child-action" />
            </MessageActionRow>,
        );

        expect(screen.findByTestId('transcript-message-actions-row:m1')).toBeTruthy();
        const timestamp = screen.findByTestId('transcript-message-timestamp:m1');
        expect(timestamp?.props).toEqual(expect.objectContaining({
            accessibilityRole: 'text',
            accessibilityLabel: 'May 19, 2026, 4:30 PM',
            focusable: true,
            onFocus: expect.any(Function),
            onHoverIn: expect.any(Function),
        }));
        expect(screen.findByTestId('transcript-message-timestamp-text:m1')?.props.children).toBe('May 19, 2026, 4:30 PM');
        expect(readOpacity(screen.findByTestId('transcript-message-actions:m1')?.props.style)).toBe(1);
        expect(screen.findByTestId('child-action')).toBeTruthy();
    });

    it('hides the action slot without letting the row capture pointer input', async () => {
        const { MessageActionRow } = await import('./MessageActionRow');

        const screen = await renderScreen(
            <MessageActionRow
                messageId="hidden"
                timestampText={null}
                showActions={false}
                isWeb={false}
                invertTimestampAndActions={false}
            >
                <View testID="hidden-child-action" />
            </MessageActionRow>,
        );

        const row = screen.findByTestId('transcript-message-actions-row:hidden');
        const actions = screen.findByTestId('transcript-message-actions:hidden');

        expect(screen.findAllByTestId('transcript-message-timestamp:hidden')).toHaveLength(0);
        expect(row?.props.pointerEvents).toBe('box-none');
        expect(readOpacity(actions?.props.style)).toBe(0);
        expect(flattenStyle(actions?.props.style).pointerEvents).toBe('none');
    });

    it('keeps a pinned pin visible while the rest of the actions stay hidden', async () => {
        const { MessageActionRow } = await import('./MessageActionRow');

        const screen = await renderScreen(
            <MessageActionRow
                messageId="pinned"
                timestampText={null}
                showActions={false}
                showPinAction
                pinAction={<View testID="pin-action" />}
                isWeb
                invertTimestampAndActions={false}
            >
                <View testID="other-action" />
            </MessageActionRow>,
        );

        expect(readOpacity(screen.findByTestId('transcript-message-pin-slot:pinned')?.props.style)).toBe(1);
        expect(readOpacity(screen.findByTestId('transcript-message-actions:pinned')?.props.style)).toBe(0);
    });

    it('uses style-level pointer events on web and inverts timestamp spacing when requested', async () => {
        const { MessageActionRow } = await import('./MessageActionRow');

        const screen = await renderScreen(
            <MessageActionRow
                messageId="web-inverted"
                timestampText="Now"
                showActions={false}
                isWeb
                invertTimestampAndActions
            >
                <View testID="web-child-action" />
            </MessageActionRow>,
        );

        const row = screen.findByTestId('transcript-message-actions-row:web-inverted');
        const timestamp = screen.findByTestId('transcript-message-timestamp:web-inverted');

        expect(row?.props.pointerEvents).toBeUndefined();
        expect(flattenStyle(row?.props.style)).toEqual(expect.objectContaining({
            flexDirection: 'row-reverse',
            pointerEvents: 'box-none',
        }));
        expect(flattenStyle(resolvePressableStyle(timestamp?.props.style))).toEqual(expect.objectContaining({
            marginLeft: 12,
            marginRight: 0,
        }));
    });
});
