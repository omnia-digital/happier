import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { useMessageReplySource } from '@/sync/domains/state/storage';
import { readMessageReplyTarget, type MessageReplyTarget } from '@/sync/domains/messages/messageReply';
import { t } from '@/text';
import { stripMarkdown } from '@/utils/sessions/messageUtils';

export function MessageReplyPreview(props: Readonly<{
    sessionId: string;
    target: MessageReplyTarget;
    testID: string;
    onCancel?: () => void;
}>) {
    const source = useMessageReplySource(props.sessionId, props.target);
    const excerpt = source?.kind === 'user-text' ? source.displayText ?? source.text : source?.text;
    return (
        <View testID={props.testID} style={styles.container}>
            <View style={styles.content}>
                <Text testID={`${props.testID}-author`} style={styles.label}>
                    {t('session.messageReply.replyingTo')} · {props.target.role === 'user' ? t('session.messageReply.user') : t('session.messageReply.assistant')}
                </Text>
                <Text testID={`${props.testID}-excerpt`} numberOfLines={2} style={styles.excerpt}>
                    {excerpt === undefined ? t('session.messageReply.sourceUnavailable') : stripMarkdown(excerpt)}
                </Text>
            </View>
            {props.onCancel ? (
                <PressableSurface
                    testID="session-composer-reply-cancel"
                    accessibilityRole="button"
                    accessibilityLabel={t('session.messageReply.cancel')}
                    onPress={props.onCancel}
                    style={styles.cancel}
                >
                    <Text style={styles.label}>{t('common.cancel')}</Text>
                </PressableSurface>
            ) : null}
        </View>
    );
}

export function SentMessageReplyPreview(props: Readonly<{ sessionId: string; messageId: string; meta: unknown }>) {
    const target = readMessageReplyTarget(props.meta);
    if (!target || target.sessionId !== props.sessionId) return null;
    return <MessageReplyPreview sessionId={props.sessionId} target={target} testID={`transcript-message-reply-source:${props.messageId}`} />;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.text.secondary,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
        backgroundColor: theme.colors.surface.elevated,
        borderRadius: 8,
    },
    content: { flex: 1, minWidth: 0 },
    label: { color: theme.colors.text.secondary },
    excerpt: { color: theme.colors.text.primary, marginTop: 4 },
    cancel: { padding: 12, minHeight: 48, justifyContent: 'center' },
}));
