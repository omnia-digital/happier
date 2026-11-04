import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});
vi.mock('@/components/ui/overlays/anchoredTooltipModuleLoader', () => ({
    loadAnchoredTooltipComponent: async () => (props: Record<string, unknown>) => React.createElement('AnchoredTooltip', props),
}));

type DomListener = (event: unknown) => void;

const ANCHOR = 'identity';
const originalDocument = (globalThis as { document?: unknown }).document;

/** The modality store watches the document once per module instance, so each case loads a fresh one. */
async function renderAnchor() {
    const listeners = new Map<string, DomListener[]>();
    (globalThis as { document?: unknown }).document = {
        addEventListener: (type: string, listener: DomListener) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener: () => {},
    };
    vi.resetModules();
    const { getInputModality } = await import('@/components/ui/interaction/inputModalityStore');
    const { SessionIdentityHoverAnchor } = await import('./SessionIdentityHoverAnchor');
    getInputModality();
    const screen = await renderScreen(
        <SessionIdentityHoverAnchor label="long-repository-name" testID={ANCHOR} focusable={true}>
            {null}
        </SessionIdentityHoverAnchor>,
    );
    return {
        screen,
        pressKey: () => { for (const listener of listeners.get('keydown') ?? []) listener({ key: 'Tab' }); },
    };
}

describe('SessionIdentityHoverAnchor', () => {
    afterEach(() => {
        standardCleanup();
        (globalThis as { document?: unknown }).document = originalDocument;
    });

    it('opens the full value when the keyboard moves focus and closes it on blur', async () => {
        const { screen, pressKey } = await renderAnchor();
        pressKey();
        await act(async () => { screen.findByTestId(ANCHOR)?.props.onFocus(); });
        await vi.waitFor(() => expect(screen.findByTestId(`${ANCHOR}-tooltip`)).not.toBeNull());
        await act(async () => { screen.findByTestId(ANCHOR)?.props.onBlur(); });
        expect(screen.findByTestId(`${ANCHOR}-tooltip`)).toBeNull();
    });

    it('does not pin the tooltip when a click focuses the anchor', async () => {
        const { screen } = await renderAnchor();
        await act(async () => { screen.findByTestId(ANCHOR)?.props.onPointerEnter(); });
        await act(async () => { screen.findByTestId(ANCHOR)?.props.onFocus(); });
        await act(async () => { screen.findByTestId(ANCHOR)?.props.onPointerLeave(); });
        expect(screen.findByTestId(`${ANCHOR}-tooltip`)).toBeNull();
    });
});
