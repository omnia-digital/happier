import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { Icon } from '@/components/ui/icons/Icon';
import { useMachineDisplayColor, useMachineDisplayIcon } from '@/sync/domains/state/storage';
import { Text } from '@/components/ui/text/Text';
import { resolveMachineDisplayColor } from './machineDisplayColor';
import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';

/** A compact name from the canonical machine presentation, with its full value available on hover. */
export const MachineDisplayGlyph = React.memo(function MachineDisplayGlyph({
    serverId, machineId, size, color,
}: Readonly<{
    serverId?: string | null;
    machineId?: string | null;
    size: number;
    color: string;
}>) {
    const icon = useMachineDisplayIcon(serverId, machineId);
    const selectedColor = useMachineDisplayColor(serverId, machineId);
    const { theme } = useUnistyles();
    return <Icon name={icon} size={size} color={resolveMachineDisplayColor(theme, selectedColor, color)} />;
});

export const SessionMachineIdentity = React.memo(function SessionMachineIdentity({
    label,
    serverId,
    machineId,
    variant,
    testID,
}: Readonly<{
    label: string;
    serverId?: string | null;
    machineId?: string | null;
    variant: 'row' | 'header';
    testID: string;
}>) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const anchorRef = React.useRef<View | null>(null);
    const isHeader = variant === 'header';
    const color = isHeader ? theme.colors.chrome.header.foreground : theme.colors.text.secondary;

    return (
        <View
            ref={anchorRef}
            testID={testID}
            accessible={true}
            accessibilityRole="text"
            accessibilityLabel={label}
            onPointerEnter={Platform.OS === 'web' ? () => setHovered(true) : undefined}
            onPointerLeave={Platform.OS === 'web' ? () => setHovered(false) : undefined}
            style={isHeader ? styles.headerIdentity : styles.rowIdentity}
        >
            <MachineDisplayGlyph serverId={serverId} machineId={machineId} size={isHeader ? 12 : 11} color={color} />
            <Text
                style={[isHeader ? styles.headerText : styles.rowText, { color }]}
                numberOfLines={1}
                ellipsizeMode="tail"
            >
                {label}
            </Text>
            {Platform.OS === 'web' && hovered ? (
                <DeferredAnchoredTooltip
                    activationKey="hovered"
                    anchorRef={anchorRef}
                    label={label}
                    placement="top"
                    testID={`${testID}-tooltip`}
                />
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    rowIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        maxWidth: 112,
        minWidth: 0,
        flexShrink: 1,
    },
    rowText: {
        ...Typography.default(),
        fontSize: 10,
        flexShrink: 1,
    },
    headerIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        maxWidth: 150,
        minWidth: 0,
        flexShrink: 1,
    },
    headerText: {
        ...Typography.default(),
        fontSize: 11,
        flexShrink: 1,
    },
}));
