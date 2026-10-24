import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { darkTheme, lightTheme } from '@/theme';
import type { SessionListVisualStatus } from '@/sync/domains/session/listing/deriveSessionListActivity';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('react-native-reanimated', () => ({
    default: { View: 'AnimatedView' },
    useAnimatedStyle: () => ({ opacity: 1 }),
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
}));

function flat(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
    return typeof style === 'object' && style !== null ? style as Record<string, unknown> : {};
}

describe('SessionRowStatusBadge', () => {
    it.each([
        ['working', 'info'], ['idle', 'neutral'], ['finished', 'success'], ['input', 'warning'], ['delivery_blocked', 'warning'], ['error', 'danger'],
    ] as const)('renders a prominent %s badge with its own semantic tint and accessible meaning', async (status, role) => {
        const { SessionRowStatusBadge } = await import('./SessionRowStatusBadge');
        const screen = await renderScreen(<SessionRowStatusBadge sessionId="s" status={status} hasUnreadMessages={false} animationEnabled={false} workingMode="spinner" />);
        const badge = screen.findByTestId(`session-row-status-s-${status}`);
        expect(badge).toBeTruthy();
        expect(badge?.props.accessibilityLabel).toBeTruthy();
        expect(flat(typeof badge?.props.style === 'function'
            ? badge.props.style({ pressed: false, hovered: false })
            : badge?.props.style)).toMatchObject({
            width: 18,
            height: 18,
            backgroundColor: lightTheme.colors.state[role].background,
        });
    });

    it.each(['queued', 'offline', 'resuming', 'archiving', 'cancelled'] as const)('keeps %s visibly distinct from an absent indicator', async (status) => {
        const { SessionRowStatusBadge } = await import('./SessionRowStatusBadge');
        const screen = await renderScreen(<SessionRowStatusBadge sessionId="s" status={status} hasUnreadMessages={false} animationEnabled={false} workingMode="spinner" />);
        const badge = screen.findByTestId(`session-row-status-s-${status}`);
        expect(badge).toBeTruthy();
        expect(badge?.props.accessibilityLabel).toBeTruthy();
    });

    it('preserves unread as a separate marker and uses the same theme role in dark mode', async () => {
        const { SessionRowStatusBadge, resolveSessionRowStatusLabel, resolveSessionRowStatusTint } = await import('./SessionRowStatusBadge');
        expect(resolveSessionRowStatusTint('finished', darkTheme)).toBe(darkTheme.colors.state.success.background);
        expect(resolveSessionRowStatusLabel('delivery_blocked')).toBe('Message blocked · Review delivery');
        expect(resolveSessionRowStatusLabel('input')).toBe('Waiting for your response');
        const screen = await renderScreen(<SessionRowStatusBadge sessionId="s" status="finished" hasUnreadMessages animationEnabled={false} workingMode="spinner" />);
        expect(screen.findByTestId('session-row-status-unread-s')).toBeTruthy();
        await screen.update(<SessionRowStatusBadge sessionId="s" status="finished" hasUnreadMessages={false} animationEnabled={false} workingMode="spinner" />);
        expect(screen.findByTestId('session-row-status-unread-s')).toBeNull();
    });

    it('honors spinner and pulse preferences in the leading working badge', async () => {
        const { SessionRowStatusBadge } = await import('./SessionRowStatusBadge');
        const screen = await renderScreen(<SessionRowStatusBadge sessionId="s" status="working" hasUnreadMessages={false} animationEnabled={false} workingMode="spinner" />);
        expect(screen.findByTestId('session-row-status-spinner-s')).toBeTruthy();
        expect(screen.findByTestId('session-row-status-pulse-s')).toBeNull();
        await screen.update(<SessionRowStatusBadge sessionId="s" status="working" hasUnreadMessages={false} animationEnabled={false} workingMode="pulse" />);
        expect(screen.findByTestId('session-row-status-spinner-s')).toBeNull();
        expect(screen.findByTestId('session-row-status-pulse-s')).toBeTruthy();
    });
});
