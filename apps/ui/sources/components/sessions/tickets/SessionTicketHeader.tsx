import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { readSessionTicketAssociation, type SessionTicketAssociationV1, type SessionTicketProvider } from '@happier-dev/protocol';
import type { Metadata, Session } from '@/sync/domains/state/storageTypes';
import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { Typography } from '@/constants/Typography';
import { useSessionTicketStatus } from '@/hooks/session/useSessionTicketStatus';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { Modal } from '@/modal';
import { t } from '@/text';
import { SessionTicketStatusLabel } from './SessionTicketStatusLabel';
import { SessionTicketLinkEditor } from './SessionTicketLinkEditor';
import { resolveSessionHeaderActionTargetPx } from '@/components/sessions/actions/sessionHeaderIconMetrics';

function TicketProviderIcon({ provider }: { provider: SessionTicketProvider }) {
    const { theme } = useUnistyles();
    // Provider marks remain monochrome, like the app's connected-service marks.
    const paths: Record<SessionTicketProvider, string> = {
        linear: 'M12 0a12 12 0 0 1 12 12c0 2.3-.65 4.44-1.76 6.27L5.73 1.76A11.94 11.94 0 0 1 12 0ZM3.98 3.04l16.98 16.98c-.43.46-.9.89-1.4 1.28L2.7 4.44c.39-.5.82-.97 1.28-1.4ZM1.55 6.3l16.15 16.15c-.66.36-1.36.66-2.08.9L.65 8.38c.24-.72.54-1.42.9-2.08ZM.06 11.1 12.9 23.94A12 12 0 0 1 .06 11.1Z',
        clickup: 'm2 5 10-5 10 5-2 4-8-4-8 4ZM2 14h4a6 6 0 0 0 12 0h4a10 10 0 0 1-20 0Z',
        jira: 'M12 0 24 12 12 24 0 12Zm0 6-6 6 6 6 6-6Z',
    };
    return <View style={styles.mark}><Svg width={14} height={14} viewBox="0 0 24 24" accessibilityLabel={provider}><Path d={paths[provider]} fill={theme.colors.text.secondary} fillRule="evenodd" /></Svg></View>;
}

function LinkedTicketHeader({ association, serverId, onEdit }: { association: SessionTicketAssociationV1; serverId: string; onEdit?: () => void }) {
    const status = useSessionTicketStatus(association, serverId);
    const ticket = status.snapshot?.ticket ?? association.ticket;
    const open = async (web = false) => {
        // Linear documents this exact scheme transformation. Other providers use canonical web
        // links; Jira support is limited to Cloud by the reader's protocol parser.
        const nativeApp = ticket.provider === 'linear' && !web;
        const opened = nativeApp && await openExternalUrl(ticket.url.replace(/^https:/, 'linear:'));
        if (!opened && !await openExternalUrl(ticket.url)) Modal.alert(t('common.error'), t('sessionTickets.openFailed'));
    };
    const fullTitle = `${ticket.provider} · ${ticket.key} · ${ticket.title}`;
    return <View style={styles.linked} testID="session-ticket-header">
        <Pressable style={styles.ticketLink} onPress={() => { void open(); }} accessibilityRole="link" accessibilityLabel={fullTitle} testID="session-ticket-open">
            <TicketProviderIcon provider={ticket.provider} /><Text style={styles.title} numberOfLines={1}>{`${ticket.key} · ${ticket.title}`}</Text>
        </Pressable>
        <SessionTicketStatusLabel ticket={ticket} state={status} testID="session-ticket-header-status" />
        <TicketHeaderButton name="arrow-clockwise" label={t('sessionTickets.refresh')} testID="session-ticket-refresh" onPress={() => { void status.refresh(); }} />
        <TicketHeaderButton name="arrow-square-out" label={t('sessionTickets.openWeb')} testID="session-ticket-open-web" onPress={() => { void open(true); }} />
        {onEdit ? <TicketHeaderButton name="pencil" label={t('sessionTickets.change')} testID="session-ticket-change" onPress={onEdit} /> : null}
    </View>;
}
function TicketHeaderButton({ name, label, testID, onPress }: { name: React.ComponentProps<typeof Icon>['name']; label: string; testID: string; onPress: () => void }) {
    const { theme } = useUnistyles();
    return <Pressable style={styles.button} accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress}><Icon name={name} size={14} color={theme.colors.text.secondary} /></Pressable>;
}
export function SessionTicketHeader({ sessionId, metadata, accessLevel, serverId }: { sessionId: string; metadata: Metadata | null; accessLevel?: Session['accessLevel']; serverId: string }) {
    const association = React.useMemo(() => readSessionTicketAssociation(metadata), [metadata]);
    const canEdit = deriveTranscriptInteraction({ kind: 'session', accessLevel, canApprovePermissions: false }).canSendMessages;
    const edit = () => {
        const scope = getActiveServerAccountScope();
        if (!scope || scope.serverId !== serverId) return;
        Modal.show({ component: SessionTicketLinkEditor, props: { sessionId, scope, association, initialDirectory: metadata?.path ?? '', initialMachineId: metadata?.machineId ?? '' } });
    };
    if (association) return <LinkedTicketHeader association={association} serverId={serverId} onEdit={canEdit ? edit : undefined} />;
    return canEdit ? <Pressable testID="session-ticket-link" accessibilityRole="button" accessibilityLabel={t('sessionTickets.link')} onPress={edit} style={styles.ticketLink}><Icon name="link" size={14} /><Text style={styles.title}>{t('sessionTickets.link')}</Text></Pressable> : null;
}

export const SessionTicketRowStatus = React.memo(function SessionTicketRowStatus({ association, serverId, sessionId }: { association: SessionTicketAssociationV1; serverId?: string; sessionId: string }) {
    const state = useSessionTicketStatus(association, serverId);
    return <View style={styles.row}><TicketProviderIcon provider={association.ticket.provider} /><SessionTicketStatusLabel ticket={association.ticket} state={state} testID={`session-ticket-row-status:${sessionId}`} /></View>;
});
const styles = StyleSheet.create((theme) => ({
    linked: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, width: '100%' },
    ticketLink: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0, minHeight: 24 },
    title: { ...Typography.default(), color: theme.colors.text.secondary, flexShrink: 1 },
    mark: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    button: { minWidth: resolveSessionHeaderActionTargetPx(), minHeight: resolveSessionHeaderActionTargetPx(), alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, marginTop: 2 },
}));
