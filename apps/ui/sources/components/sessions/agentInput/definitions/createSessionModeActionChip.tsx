import * as React from 'react';
import type { View } from 'react-native';

import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE } from './agentInputChipIconMetrics';

export function createSessionModeActionChip(params: Readonly<{
    anchorRef: React.RefObject<View | null>;
    tint: string;
    label: string;
    accessibilityLabel: string;
    chipStyle: (pressed: boolean) => any;
    iconName?: IconName;
    onPress: () => void;
}>): React.ReactNode {
    const testID = 'agent-input-session-mode-chip';
    return (
        <PressableSurface
            anchorRef={params.anchorRef}
            testID={testID}
            key="mode"
            onPress={params.onPress}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            style={[params.chipStyle(false), { paddingHorizontal: 8, gap: 0 }]}
            accessibilityRole="button"
            accessibilityLabel={params.accessibilityLabel}
            webTooltip={params.label}
            tooltipPlacement="top"
            focusRingRadius={16}
        >
            <Icon name={params.iconName ?? 'list'} size={AGENT_INPUT_CHIP_ICON_SIZE_PX} color={params.tint} style={AGENT_INPUT_CHIP_ICON_STYLE} />
        </PressableSurface>
    );
}
