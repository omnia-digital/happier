import * as React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';
import { getInputModality } from '@/components/ui/interaction/inputModalityStore';

/** Compact session identity text whose full value stays available on hover and keyboard focus. */
export function SessionIdentityHoverAnchor({
    label,
    testID,
    focusable = false,
    style,
    children,
}: Readonly<{
    label: string;
    testID: string;
    focusable?: boolean;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}>) {
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const anchorRef = React.useRef<View | null>(null);
    const isWeb = Platform.OS === 'web';
    const focusableOnWeb = isWeb && focusable;

    return (
        <View
            ref={anchorRef}
            testID={testID}
            accessible={true}
            accessibilityRole="text"
            accessibilityLabel={label}
            tabIndex={focusableOnWeb ? 0 : undefined}
            onPointerEnter={isWeb ? () => setHovered(true) : undefined}
            onPointerLeave={isWeb ? () => setHovered(false) : undefined}
            // A click lands focus here too, and that must not pin the tooltip after the pointer leaves.
            onFocus={focusableOnWeb ? () => setFocused(getInputModality() === 'keyboard') : undefined}
            onBlur={focusableOnWeb ? () => setFocused(false) : undefined}
            style={style}
        >
            {children}
            {isWeb && (hovered || focused) ? (
                <DeferredAnchoredTooltip
                    activationKey={focused ? 'focused' : 'hovered'}
                    anchorRef={anchorRef}
                    label={label}
                    placement="top"
                    testID={`${testID}-tooltip`}
                />
            ) : null}
        </View>
    );
}
