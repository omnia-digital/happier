import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';

import { RowActionRevealSlot } from './RowActionRevealSlot';

/**
 * Timestamp + hover-revealed actions for one transcript message.
 *
 * The pin has its own reveal slot: a pinned row must keep showing its pin
 * without dragging the rest of the actions — or the timestamp presentation —
 * into view. The container never captures pointer input; each slot owns whether
 * its own children are clickable.
 */
export function MessageActionRow(props: Readonly<{
    children: React.ReactNode;
    isWeb: boolean;
    invertTimestampAndActions: boolean;
    messageId: string;
    showActions: boolean;
    showPinAction?: boolean;
    pinAction?: React.ReactNode;
    onActionsFocus?: () => void;
    onActionsBlur?: () => void;
    timestampText: string | null;
}>): React.ReactElement {
    const hasTimestamp = typeof props.timestampText === 'string' && props.timestampText.length > 0;
    return (
        <View
            {...(props.isWeb ? {} : { pointerEvents: 'box-none' as const })}
            style={[
                styles.container,
                props.invertTimestampAndActions ? styles.containerInverted : null,
                props.isWeb ? styles.containerWebPointerEvents : null,
            ]}
            testID={`transcript-message-actions-row:${props.messageId}`}
        >
            {hasTimestamp ? (
                <PressableSurface
                    testID={`transcript-message-timestamp:${props.messageId}`}
                    accessibilityRole="text"
                    accessibilityLabel={props.timestampText}
                    focusable={props.isWeb}
                    webTooltip={props.isWeb ? props.timestampText : undefined}
                    style={[
                        styles.timestampTooltipAnchor,
                        props.invertTimestampAndActions ? styles.timestampTooltipAnchorInverted : null,
                    ]}
                >
                    <Text
                        testID={`transcript-message-timestamp-text:${props.messageId}`}
                        numberOfLines={1}
                        style={styles.timestampText}
                    >
                        {props.timestampText}
                    </Text>
                </PressableSurface>
            ) : null}
            {props.pinAction ? (
                <RowActionRevealSlot
                    revealed={props.showPinAction === true}
                    onFocus={props.onActionsFocus}
                    onBlur={props.onActionsBlur}
                    testID={`transcript-message-pin-slot:${props.messageId}`}
                >
                    {props.pinAction}
                </RowActionRevealSlot>
            ) : null}
            <RowActionRevealSlot
                revealed={props.showActions}
                onFocus={props.onActionsFocus}
                onBlur={props.onActionsBlur}
                testID={`transcript-message-actions:${props.messageId}`}
            >
                {props.children}
            </RowActionRevealSlot>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    containerInverted: {
        flexDirection: 'row-reverse',
    },
    containerWebPointerEvents: {
        pointerEvents: 'box-none',
    },
    timestampTooltipAnchor: {
        flexShrink: 1,
        marginRight: 8,
    },
    timestampTooltipAnchorInverted: {
        marginLeft: 12,
        marginRight: 0,
    },
    timestampText: {
        color: theme.colors.text.tertiary,
        fontSize: 11,
        lineHeight: 16,
    },
}));
