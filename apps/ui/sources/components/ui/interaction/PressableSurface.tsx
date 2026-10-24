import * as React from 'react';
import { Platform, Pressable, type View } from 'react-native';
import type {
    AccessibilityRole,
    AccessibilityState,
    GestureResponderEvent,
    PressableProps,
    StyleProp,
    ViewStyle,
} from 'react-native';

import { FocusRing, WEB_FOCUS_OUTLINE_RESET, type FocusRingPlacement } from '@/components/ui/interaction/FocusRing';
import { useIsKeyboardModality } from '@/components/ui/interaction/inputModalityStore';
import { usePressFeedback, type PressFeedbackTone } from '@/components/ui/interaction/usePressFeedback';

import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';

/**
 * A `Pressable` that already knows the two things every pressable in this app kept getting wrong:
 * press feedback tints the surface instead of dimming the content, and keyboard focus is visible
 * while touch focus is not.
 *
 * It owns no box of its own — no size, no radius, no chrome. `IconAction` and `ToolbarButton` keep
 * their own geometry and hand it in, which is why adopting this changed neither of them visually.
 */

export type PressableSurfaceProps = Readonly<{
    children?: React.ReactNode;
    onPress?: (event: GestureResponderEvent) => void;
    onLongPress?: (event: GestureResponderEvent) => void;
    disabled?: boolean;
    /** Decorative hover targets can keep a tooltip without creating another keyboard stop. */
    focusable?: boolean;
    /** Renders the resting fill as if hovered — a control that is toggled on. */
    active?: boolean;
    tone?: PressFeedbackTone;
    hitSlop?: PressableProps['hitSlop'];
    accessibilityRole?: AccessibilityRole;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    accessibilityState?: AccessibilityState;
    /** Corner radius the focus ring traces. Keep it equal to the box's own radius. */
    focusRingRadius?: number;
    focusRingPlacement?: FocusRingPlacement;
    /** The control's own box styling. The feedback fill is applied ON TOP of it. */
    style?: PressableProps['style'];
    /**
     * Applied LAST, after the feedback fill, so a consumer's `style` prop still has the final word
     * — which is the ordering the adopting controls already had.
     */
    styleOverride?: StyleProp<ViewStyle>;
    /** Portaled hover/keyboard-focus tooltip on web; a no-op elsewhere. */
    webTooltip?: string;
    tooltipContent?: React.ReactNode;
    tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right';
    /** Share the control's existing anchor when it also positions an adjacent popover. */
    anchorRef?: React.RefObject<View | null>;
    testID?: string;
}>;

export const PressableSurface = React.memo((props: PressableSurfaceProps) => {
    const disabled = props.disabled ?? false;
    const feedback = usePressFeedback({
        tone: props.tone ?? 'control',
        disabled,
        selected: props.active,
    });

    const keyboardModality = useIsKeyboardModality();
    const [focused, setFocused] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
    const internalAnchorRef = React.useRef<View | null>(null);
    const anchorRef = props.anchorRef ?? internalAnchorRef;
    const ringVisible = focused && keyboardModality && !disabled;
    // `FocusRing` runs a Reanimated animated style, so an always-mounted one would cost a shared
    // value per control on every surface in the app for a ring that native can never show (RN
    // reports no keypress, so the modality never leaves `pointer` there). `focused` keeps it
    // mounted while it fades out after the user drops back to the pointer.
    const ringMounted = keyboardModality || focused;

    const handleFocus = React.useCallback(() => setFocused(true), []);
    const handleBlur = React.useCallback(() => setFocused(false), []);
    const handleHoverIn = React.useCallback(() => setHovered(true), []);
    const handleHoverOut = React.useCallback(() => setHovered(false), []);

    const resolveStyle = React.useCallback(({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => {
        const backgroundColor = feedback.resolveBackgroundColor({ pressed, hovered });
        const interactionState = { pressed: pressed === true, hovered: hovered === true };
        const consumerStyle = typeof props.style === 'function'
            ? props.style(interactionState)
            : props.style;
        return [
            consumerStyle,
            Platform.OS === 'web' ? WEB_FOCUS_OUTLINE_RESET : null,
            backgroundColor === undefined ? null : { backgroundColor },
            props.styleOverride,
        ];
    }, [feedback, props.style, props.styleOverride]);

    return (
        <Pressable
            ref={anchorRef}
            testID={props.testID}
            onPress={disabled ? undefined : props.onPress}
            onLongPress={disabled ? undefined : props.onLongPress}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onHoverIn={props.webTooltip ? handleHoverIn : undefined}
            onHoverOut={props.webTooltip ? handleHoverOut : undefined}
            hitSlop={props.hitSlop}
            disabled={disabled}
            focusable={props.focusable}
            tabIndex={props.focusable === false ? -1 : undefined}
            accessibilityRole={props.accessibilityRole ?? 'button'}
            accessibilityLabel={props.accessibilityLabel}
            accessibilityHint={props.accessibilityHint}
            accessibilityState={{ ...props.accessibilityState, disabled }}
            aria-checked={props.accessibilityState?.checked}
            aria-expanded={props.accessibilityState?.expanded}
            aria-selected={props.accessibilityState?.selected}
            aria-busy={props.accessibilityState?.busy}
            {...(Platform.OS === 'web' && (props.accessibilityRole === 'switch' || props.accessibilityRole === 'checkbox') ? {
                // RN Web activates Space only for button roles; checkable controls need the same key contract.
                onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                    if (event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                },
                onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => {
                    if (event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!disabled) event.currentTarget.click();
                },
            } : null)}
            style={resolveStyle}
        >
            {props.children}
            {Platform.OS === 'web' && props.webTooltip && (hovered || ringVisible) ? (
                <DeferredAnchoredTooltip activationKey={`${hovered}:${focused}`} anchorRef={anchorRef} label={props.webTooltip} content={props.tooltipContent} placement={props.tooltipPlacement} testID={props.testID ? `${props.testID}-tooltip` : undefined} />
            ) : null}
            {ringMounted ? (
                <FocusRing
                    testID={props.testID === undefined ? undefined : `${props.testID}-focus-ring`}
                    visible={ringVisible}
                    radius={props.focusRingRadius}
                    placement={props.focusRingPlacement}
                />
            ) : null}
        </Pressable>
    );
});

PressableSurface.displayName = 'PressableSurface';
