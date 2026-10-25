import React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { SessionWorkStateItem } from '@/components/sessions/workState/sessionWorkStateTypes';
import { resolveGoalStatusLabelKey } from '@/components/sessions/workState/goalActionVisibility';
import { resolveSidebarGoalTone } from '@/components/sessions/workState/sessionWorkStatePresentation';
import { Icon } from '@/components/ui/icons/Icon';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { t } from '@/text';

const stylesheet = StyleSheet.create(() => ({
    indicator: {
        width: 16,
        height: 16,
        marginLeft: 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
}));

export const SessionRowGoalIndicator = React.memo(function SessionRowGoalIndicator(props: Readonly<{
    goal: SessionWorkStateItem;
    sessionId: string;
    compact: boolean;
    minimal: boolean;
}>) {
    const { theme } = useUnistyles();
    const tone = resolveSidebarGoalTone(props.goal);
    const palette = theme.colors.state[tone === 'active' ? 'info' : tone === 'complete' ? 'success' : 'neutral'];
    const label = `${t('session.workState.goal.title')}: ${props.goal.title}, ${t(resolveGoalStatusLabelKey(props.goal))}`;

    return (
        <PressableSurface
            testID={`session-list-goal-indicator:${props.sessionId}`}
            accessibilityRole="image"
            accessibilityLabel={label}
            focusable={Platform.OS === 'web'}
            webTooltip={Platform.OS === 'web' ? label : undefined}
            style={stylesheet.indicator}
        >
            <View pointerEvents="none">
                <Icon name="target" size={props.minimal ? 10 : props.compact ? 11 : 12} color={palette.onTint} />
            </View>
        </PressableSurface>
    );
});
