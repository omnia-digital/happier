import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Popover } from '@/components/ui/popover/Popover';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/** Mounted only while its trigger is hovered or keyboard-focused. Popover owns portal geometry. */
export default function AnchoredTooltip(props: Readonly<{
    anchorRef: React.RefObject<View | null>;
    label: string;
    content?: React.ReactNode;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    return (
        <Popover open anchorRef={props.anchorRef} backdrop={false} contentPointerEvents="none" portal={{ web: true, matchAnchorWidth: false }} placement={props.placement ?? 'bottom'} gap={6} maxWidthCap={240}>
            {() => (
                <View role="tooltip" testID={props.testID} style={{ alignSelf: props.placement === 'left' ? 'flex-end' : 'flex-start', maxWidth: '100%', pointerEvents: 'none', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border.surface, backgroundColor: theme.colors.surface.elevated }}>
                    {props.content ?? <Text style={{ ...Typography.default(), fontSize: 12, lineHeight: 16, color: theme.colors.text.primary }}>{props.label}</Text>}
                </View>
            )}
        </Popover>
    );
}
