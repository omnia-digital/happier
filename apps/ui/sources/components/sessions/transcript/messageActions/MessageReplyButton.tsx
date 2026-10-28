import * as React from 'react';
import { Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SessionMessageReplyActionContext } from '@/components/sessions/agentInput/useSessionComposerReply';
import { ICON_SIZE } from '@/components/ui/icons/Icon';
import { createMessageReplyTarget, type ReplyableMessage } from '@/sync/domains/messages/messageReply';
import { t } from '@/text';

export function MessageReplyButton(props: Readonly<{
    sessionId: string;
    message: ReplyableMessage;
    canSendMessages: boolean;
    onHoverIn?: () => void;
    onHoverOut?: () => void;
}>) {
    const selectReply = React.useContext(SessionMessageReplyActionContext);
    const { theme } = useUnistyles();
    if (!selectReply || !props.canSendMessages) return null;
    return (
        <Pressable
            testID={`transcript-message-reply:${props.message.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('session.messageReply.action')}
            onPress={() => selectReply(createMessageReplyTarget(props.sessionId, props.message))}
            onHoverIn={props.onHoverIn}
            onHoverOut={props.onHoverOut}
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        >
            <Ionicons name="arrow-undo-outline" size={ICON_SIZE.xs} color={theme.colors.text.secondary} />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    button: {
        padding: Platform.OS === 'web' ? 6 : 12,
        minWidth: Platform.OS === 'android' ? 48 : Platform.OS === 'ios' ? 44 : 24,
        minHeight: Platform.OS === 'android' ? 48 : Platform.OS === 'ios' ? 44 : 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        // Neighboring legacy actions extend their hit areas by 15 points.
        // Keep the reply's physical target clear of those extensions.
        marginLeft: Platform.OS === 'web' ? 0 : 15,
        marginRight: Platform.OS === 'web' ? 6 : 15,
    },
    pressed: { backgroundColor: theme.colors.state.neutral.background },
}));
