import * as React from 'react';
import { Text, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

// Use a configurable spring stub so individual tests can choose whether to
// fire the completion callback (committing the in-flight target) or not.
const springControls = vi.hoisted(() => ({
    fireCallbackImmediately: false,
    complete: null as ((finished?: boolean) => void) | null,
}));

vi.mock('react-native-reanimated', async () => {
    const ReactModule = await import('react');
    type SharedValue<T> = { value: T };
    const useSharedValue = <T,>(initial: T): SharedValue<T> => {
        const ref = ReactModule.useRef<SharedValue<T> | null>(null);
        if (!ref.current) ref.current = { value: initial };
        return ref.current;
    };
    const useAnimatedStyle = <T,>(factory: () => T): T => factory();
    const useAnimatedProps = <T,>(factory: () => T): T => factory();
    const runOnJS = <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => fn;
    const cancelAnimation = () => {};
    const withSpring = <T,>(value: T, _config?: unknown, callback?: (finished?: boolean) => void) => {
        springControls.complete = callback ?? null;
        if (springControls.fireCallbackImmediately && callback) callback(true);
        return value;
    };
    const Animated = {
        View: 'Animated.View',
        ScrollView: 'Animated.ScrollView',
        Text: 'Animated.Text',
        createAnimatedComponent: (component: unknown) => component,
    };
    return {
        __esModule: true,
        default: Animated,
        ...Animated,
        // The slide springs carry an explicit reduced-motion policy (`slideTransitionTokens`
        // -> `motionSprings.resolveReduceMotionPolicy`), so the enum has to exist on the mock.
        ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
        cancelAnimation,
        runOnJS,
        useAnimatedProps,
        useAnimatedStyle,
        useSharedValue,
        withSpring,
    };
});

function DraftEditor() {
    const [value, setValue] = React.useState('seed');
    return <TextInput testID="draft-editor" value={value} onChangeText={setValue} />;
}

describe('SlideTransitionSwitch (discrete adapter)', () => {
    it.each(['forward', 'backward'] as const)('preserves the incoming draft when a %s transition settles', async (direction) => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction={direction} reducedMotion={false}>
                <Text>Previous</Text>
            </SlideTransitionSwitch>,
        );
        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction={direction} reducedMotion={false}>
                <DraftEditor />
            </SlideTransitionSwitch>,
        );
        await act(async () => {
            screen.changeTextByTestId('draft-editor', 'unsaved edit');
        });
        expect(screen.findByTestId('draft-editor')?.props.value).toBe('unsaved edit');

        await act(async () => {
            springControls.complete?.(true);
        });

        expect(screen.findByTestId('draft-editor')?.props.value).toBe('unsaved edit');
    });

    it('mounts only the current slot when no transition is active', async () => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        expect(screen.findByTestId('switch-current-layer')).not.toBeNull();
        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
        expect(screen.findByTestId('step-a')).not.toBeNull();
    });

    it('keeps the latest same-key children mounted as the outgoing layer during a forward transition', async () => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const commits: string[] = [];
        const onRender: React.ProfilerOnRenderCallback = (_id, phase) => { commits.push(phase); };
        const content = (key: string, children: React.ReactNode) => (
            <React.Profiler id="same-key-content" onRender={onRender}>
                <SlideTransitionSwitch contentKey={key} direction="forward" testID="switch">
                    {children}
                </SlideTransitionSwitch>
            </React.Profiler>
        );
        const screen = await renderScreen(
            content('a', <Text testID="step-a-original">A</Text>),
        );
        commits.length = 0;
        await screen.update(
            content('a', <Text testID="step-a">Updated A</Text>),
        );
        expect(screen.findByTestId('step-a-original')).toBeNull();
        expect(screen.findByTestId('step-a')).not.toBeNull();
        // Retaining the next outgoing snapshot must not publish a second render.
        expect(commits).toEqual(['update']);

        await screen.update(
            content('b', <Text testID="step-b">B</Text>),
        );

        // During the in-flight transition: outgoing (A) is current, incoming (B) is next.
        expect(screen.findByTestId('step-a')).not.toBeNull();
        expect(screen.findByTestId('step-b')).not.toBeNull();
        expect(screen.findByTestId('switch-next-layer')).not.toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
    });

    it('places incoming content in the previous slot for backward transitions', async () => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="backward" testID="switch">
                <Text testID="step-b">B</Text>
            </SlideTransitionSwitch>,
        );

        expect(screen.findByTestId('switch-previous-layer')).not.toBeNull();
        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('step-a')).not.toBeNull();
        expect(screen.findByTestId('step-b')).not.toBeNull();
    });

    it('commits the new key once the spring completes (outgoing unmounts)', async () => {
        springControls.fireCallbackImmediately = true;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="forward" testID="switch">
                <Text testID="step-b">B</Text>
            </SlideTransitionSwitch>,
        );

        expect(screen.findByTestId('switch-current-layer')).not.toBeNull();
        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
        expect(screen.findByTestId('step-b')).not.toBeNull();
        expect(screen.findByTestId('step-a')).toBeNull();
    });

    it('commits replace direction synchronously without a spring', async () => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="replace" testID="switch">
                <Text testID="step-b">B</Text>
            </SlideTransitionSwitch>,
        );

        // Replace path: instant commit, single layer, no outgoing.
        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
        expect(screen.findByTestId('step-a')).toBeNull();
        expect(screen.findByTestId('step-b')).not.toBeNull();
    });

    it('commits synchronously when reducedMotion is true', async () => {
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" reducedMotion testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="forward" reducedMotion testID="switch">
                <Text testID="step-b">B</Text>
            </SlideTransitionSwitch>,
        );

        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
        expect(screen.findByTestId('step-a')).toBeNull();
        expect(screen.findByTestId('step-b')).not.toBeNull();
    });

    it('settles to the latest content after rapid back-to-back key changes', async () => {
        // Rapid keys without firing the callback would leave the first transition
        // in flight when the second one starts. The interrupt rule must snap-commit
        // the previous in-flight target and start fresh, ending up rendering 'c'
        // in the current slot eventually. Even with the spring callback wired so
        // each spring completes, the final content must always be the latest.
        springControls.fireCallbackImmediately = true;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );

        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="forward" testID="switch">
                <Text testID="step-b">B</Text>
            </SlideTransitionSwitch>,
        );
        await screen.update(
            <SlideTransitionSwitch contentKey="c" direction="forward" testID="switch">
                <Text testID="step-c">C</Text>
            </SlideTransitionSwitch>,
        );

        // After all springs settle, only the latest content is visible.
        expect(screen.findByTestId('step-c')).not.toBeNull();
        expect(screen.findByTestId('step-a')).toBeNull();
        expect(screen.findByTestId('step-b')).toBeNull();
        expect(screen.findByTestId('switch-next-layer')).toBeNull();
        expect(screen.findByTestId('switch-previous-layer')).toBeNull();
    });

    it('keeps the in-flight transition running and refreshes incoming content on same-key updates', async () => {
        // Start transition a → b. While in flight (callback NOT fired), update children
        // for the same key b. The incoming layer should reflect the latest children
        // (B v2) rather than the original B v1. Then trigger another distinct key
        // change (c) so the interrupt rule snap-commits the in-flight target — and the
        // committed content must be B v2 (the latest), not B v1.
        springControls.fireCallbackImmediately = false;
        const { SlideTransitionSwitch } = await import('./SlideTransitionSwitch');
        const screen = await renderScreen(
            <SlideTransitionSwitch contentKey="a" direction="forward" testID="switch">
                <Text testID="step-a">A</Text>
            </SlideTransitionSwitch>,
        );
        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="forward" testID="switch">
                <Text testID="step-b-v1">B v1</Text>
            </SlideTransitionSwitch>,
        );
        // Same-key update: incoming children change from B v1 to B v2 mid-flight.
        await screen.update(
            <SlideTransitionSwitch contentKey="b" direction="forward" testID="switch">
                <Text testID="step-b-v2">B v2</Text>
            </SlideTransitionSwitch>,
        );

        // V2 is in the next slot (incoming layer reflects the latest children).
        expect(screen.findByTestId('step-b-v2')).not.toBeNull();
        expect(screen.findByTestId('step-b-v1')).toBeNull();
        expect(screen.findByTestId('switch-next-layer')).not.toBeNull();
        expect(screen.findByTestId('step-a')).not.toBeNull();

        // Trigger a fresh transition to 'c' — interrupt rule snap-commits the in-flight
        // target (which must be B v2, not B v1) and starts a new spring for c.
        await screen.update(
            <SlideTransitionSwitch contentKey="c" direction="forward" testID="switch">
                <Text testID="step-c">C</Text>
            </SlideTransitionSwitch>,
        );
        // After the snap-commit, displayed key/children = (b, B v2). The new spring
        // for c is in flight (callback not firing). So `current` slot = B v2 (the
        // snap-committed outgoing) and `next` slot = C (the new incoming).
        expect(screen.findByTestId('step-b-v2')).not.toBeNull();
        expect(screen.findByTestId('step-b-v1')).toBeNull();
        expect(screen.findByTestId('step-a')).toBeNull();
        expect(screen.findByTestId('step-c')).not.toBeNull();
    });
});
