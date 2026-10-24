import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { SessionContextChips } from '@/components/sessions/context/SessionContextChips';
import { Icon } from '@/components/ui/icons/Icon';
import { IconAction } from '@/components/ui/buttons/IconAction';
import {
    SessionListIdentity,
    type SessionListIdentityDisplay,
} from '@/components/sessions/shell/SessionListIdentity';
import { SESSION_LIST_ROW_IDENTITY_METRICS } from '@/components/sessions/shell/sessionListRowDensity';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

export const InboxSessionAttentionHeader = React.memo(function InboxSessionAttentionHeader(props: Readonly<{
    session: Session | SessionListRenderableSession;
    identityDisplay: SessionListIdentityDisplay;
    sessionTitle: string;
    machineLabel: string | null;
    machineId?: string | null;
    serverId?: string | null;
    workspaceLabel: string | null;
    statusLabel: string;
    onOpenSession: () => void;
}>) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            <SessionListIdentity
                session={props.session}
                display={props.identityDisplay}
                avatarSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize}
                agentLogoSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.agentLogoSize}
                color={theme.colors.text.primary}
                testID={`inbox.session_attention.${props.session.id}.identity`}
            />
            <View style={styles.titleColumn}>
                <Text style={styles.title} numberOfLines={1}>
                    {props.sessionTitle}
                </Text>
                <Text style={styles.reason} numberOfLines={2}>{props.statusLabel}</Text>
                <SessionContextChips machineLabel={props.machineLabel} machineId={props.machineId} serverId={props.serverId} pathLabel={props.workspaceLabel} />
            </View>

            <IconAction
                accessibilityRole="button"
                accessibilityLabel={t('common.open')}
                onPress={props.onOpenSession}
                size="lg"
                hitSlop={3}
            >
                <Icon name="arrow-square-out" size={16} color={theme.colors.text.primary} />
            </IconAction>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
    },
    titleColumn: {
        flex: 1,
        minWidth: 0,
        gap: 8,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    reason: {
        color: theme.colors.text.secondary,
    },
}));
