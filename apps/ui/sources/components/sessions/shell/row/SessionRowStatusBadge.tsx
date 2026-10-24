import React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import type { IconName } from '@/components/ui/icons/iconRegistry.generated';
import { t } from '@/text';
import type { Theme } from '@/theme';
import type { SessionListVisualStatus } from '@/sync/domains/session/listing/deriveSessionListActivity';

type StatusRole = 'info' | 'neutral' | 'success' | 'warning' | 'danger';

export function resolveSessionRowStatusRole(status: SessionListVisualStatus): StatusRole {
    switch (status) {
        case 'working': case 'resuming': return 'info';
        case 'finished': return 'success';
        case 'input': return 'warning';
        case 'error': return 'danger';
        case 'idle': case 'queued': case 'offline': case 'archiving': case 'cancelled': return 'neutral';
    }
}

export function resolveSessionRowStatusTint(status: SessionListVisualStatus, theme: Theme): string {
    return theme.colors.state[resolveSessionRowStatusRole(status)].background;
}

const stylesheet = StyleSheet.create(() => ({
    badge: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    unread: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 5,
        height: 5,
        borderRadius: 3,
    },
}));

export const SessionRowStatusBadge = React.memo(function SessionRowStatusBadge(props: Readonly<{
    sessionId: string;
    status: SessionListVisualStatus;
    hasUnreadMessages: boolean;
    animationEnabled: boolean;
}>) {
    const { theme } = useUnistyles();
    const role = resolveSessionRowStatusRole(props.status);
    const palette = theme.colors.state[role];
    const label = (() => {
        switch (props.status) {
            case 'working': return t('status.working');
            case 'idle': return t('status.sidebarIdle');
            case 'finished': return t('status.sidebarFinished');
            case 'input': return t('status.waitingForYourResponse');
            case 'error': return t('status.error');
            case 'queued': return t('session.pendingActivation.queued.title');
            case 'offline': return t('status.offline');
            case 'resuming': return t('session.resuming');
            case 'archiving': return t('status.archiving');
            case 'cancelled': return t('status.sidebarCancelled');
        }
    })();
    const iconName = ((): IconName | null => {
        switch (props.status) {
            case 'idle': return 'circle';
            case 'finished': return 'check';
            case 'input': return 'question';
            case 'error': return 'x';
            case 'queued': return 'clock';
            case 'offline': return 'stop';
            case 'resuming': return 'arrow-clockwise';
            case 'archiving': return 'archive';
            case 'cancelled': return 'minus';
            case 'working': return null;
        }
    })();
    return (
        <View
            testID={`session-row-status-${props.sessionId}-${props.status}`}
            accessibilityRole="image"
            accessibilityLabel={label}
            {...(Platform.OS === 'web' ? { title: label } : {})}
            style={[stylesheet.badge, { borderColor: palette.border, backgroundColor: palette.background }]}
        >
            {iconName ? <Icon name={iconName} size={11} color={palette.onTint} /> : (
                <ActivitySpinner size={13} color={palette.onTint} animationEnabled={props.animationEnabled} />
            )}
            {props.hasUnreadMessages ? <View testID={`session-row-status-unread-${props.sessionId}`} style={[stylesheet.unread, { backgroundColor: theme.colors.text.link }]} /> : null}
        </View>
    );
});
