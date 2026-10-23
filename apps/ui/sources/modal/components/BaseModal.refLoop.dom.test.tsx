/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { useModalPortalTarget } from '@/modal/portal/ModalPortalTarget';
import { installModalComponentCommonModuleMocks } from './modalComponentTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flattenStyle(style: unknown): React.CSSProperties | undefined {
    if (style == null) return undefined;
    if (Array.isArray(style)) {
        return style.reduce<React.CSSProperties>((acc, entry) => ({ ...acc, ...(flattenStyle(entry) ?? {}) }), {});
    }
    if (typeof style === 'object') {
        return style as React.CSSProperties;
    }
    return undefined;
}

installModalComponentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');

        const View = React.forwardRef<HTMLDivElement, any>(function View(props, ref) {
            const { children, style, testID, nativeID, pointerEvents, ...rest } = props;
            return React.createElement(
                'div',
                {
                    ...rest,
                    ref,
                    id: nativeID,
                    'data-testid': testID,
                    'data-pointer-events': pointerEvents,
                    style: flattenStyle(style),
                },
                children,
            );
        });

        const KeyboardAvoidingView = React.forwardRef<HTMLDivElement, any>(function KeyboardAvoidingView(props, ref) {
            return React.createElement(View, { ...props, ref });
        });

        const TouchableWithoutFeedback = (props: any) => React.createElement(React.Fragment, null, props.children);
        const AnimatedView = React.forwardRef<HTMLDivElement, any>(function AnimatedView(props, ref) {
            return React.createElement(View, { ...props, ref });
        });

        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: <T,>(options: { web?: T; default?: T; ios?: T; android?: T }) =>
                    options.web ?? options.default ?? options.ios ?? options.android,
            },
            View,
            KeyboardAvoidingView,
            TouchableWithoutFeedback,
            Animated: {
                Value: function Value(this: any, initial: number) {
                    this.__value = initial;
                    this.interpolate = () => this;
                },
                timing: (_value: any, _config: any) => ({
                    start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }),
                }),
                View: AnimatedView,
            },
            StyleSheet: {
                absoluteFillObject: {},
                create: (styles: any) => styles,
                flatten: flattenStyle,
            },
        });
    },
});

const safeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('BaseModal (dom ref loop)', () => {
    it('handles opt-in Enter at the dialog capture boundary before its focused Cancel button', async () => {
        const { BaseModal } = await import('./BaseModal');
        const { SafeAreaInsetsContext } = await import('react-native-safe-area-context');
        const calls: string[] = [];
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => {
                root.render(
                    <SafeAreaInsetsContext.Provider value={safeAreaInsets}>
                        <BaseModal visible={true} onWebKeyDownCapture={(event) => {
                            if (event.key !== 'Enter') return;
                            calls.push('confirm');
                            event.preventDefault();
                            event.stopPropagation();
                        }}>
                            <button data-testid="focused-cancel" onKeyDown={() => calls.push('cancel')}>Cancel</button>
                        </BaseModal>
                    </SafeAreaInsetsContext.Provider>,
                );
            });
            const cancel = document.querySelector('[data-testid="focused-cancel"]');
            expect(cancel).not.toBeNull();
            await act(async () => {
                cancel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            });
            expect(calls).toEqual(['confirm']);
        } finally {
            await act(async () => root.unmount());
            container.remove();
        }
    });
    it('provides the modal portal target on first mount without a follow-up render', async () => {
        const { BaseModal } = await import('./BaseModal');
        const { SafeAreaInsetsContext } = await import('react-native-safe-area-context');

        const observedTargets: Array<unknown> = [];

        function Probe() {
            observedTargets.push(useModalPortalTarget());
            return React.createElement('span', { 'data-testid': 'probe' });
        }

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        try {
            await act(async () => {
                root.render(
                    <SafeAreaInsetsContext.Provider value={safeAreaInsets}>
                        <BaseModal visible={true}>
                            <Probe />
                        </BaseModal>
                    </SafeAreaInsetsContext.Provider>,
                );
            });

            expect(observedTargets).toHaveLength(1);
            expect(observedTargets[0]).toBeInstanceOf(HTMLElement);
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        }
    });

    it('does not churn the modal portal target across parent re-renders', async () => {
        const { BaseModal } = await import('./BaseModal');
        const { SafeAreaInsetsContext } = await import('react-native-safe-area-context');
        let latestTick = -1;

        function Probe(props: Readonly<{ bump: () => void }>) {
            const target = useModalPortalTarget();
            const { bump } = props;

            React.useLayoutEffect(() => {
                if (!target) return;
                bump();
            }, [bump, target]);

            return React.createElement('span', { 'data-testid': 'probe' });
        }

        function Harness() {
            const [tick, setTick] = React.useState(0);
            const bump = React.useCallback(() => setTick((value) => value + 1), []);
            latestTick = tick;

            return (
                <SafeAreaInsetsContext.Provider value={safeAreaInsets}>
                    <BaseModal visible={true}>
                        <Probe bump={bump} />
                    </BaseModal>
                </SafeAreaInsetsContext.Provider>
            );
        }

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        try {
            await act(async () => {
                root.render(<Harness />);
            });

            expect(latestTick).toBe(1);
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        }
    });
});
