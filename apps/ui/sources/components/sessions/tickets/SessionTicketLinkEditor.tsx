import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { parseSessionTicketUrl, readSessionTicketAssociation, withSessionTicketAssociation, TicketReaderErrorCodeSchema, type SessionTicketAssociationV1, type SessionTicketSnapshotV1 } from '@happier-dev/protocol';
import { Text, TextInput } from '@/components/ui/text/Text';
import { useActiveServerAccountScope, useAllMachines, storage } from '@/sync/domains/state/storage';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { listSessionTicketSources, readSessionTicket } from '@/sync/ops/sessionTickets';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';

export function SessionTicketLinkEditor({ sessionId, scope, association, initialDirectory, initialMachineId, onClose }: Readonly<{
    sessionId: string; scope: ServerAccountScope; association: SessionTicketAssociationV1 | null;
    initialDirectory: string; initialMachineId: string; onClose: () => void;
}>) {
    const machines = useAllMachines();
    const activeScope = useActiveServerAccountScope();
    const [machineId, setMachineId] = React.useState(association?.reader.machineId ?? initialMachineId);
    const [directory, setDirectory] = React.useState(association?.reader.directory ?? initialDirectory);
    const [url, setUrl] = React.useState(association?.ticket.url ?? '');
    const [sources, setSources] = React.useState<ReadonlyArray<{ id: string; title: string }>>([]);
    const [sourceId, setSourceId] = React.useState(association?.reader.mcpServerId ?? '');
    const [snapshot, setSnapshot] = React.useState<SessionTicketSnapshotV1 | null>(null);
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mounted = React.useRef(true);
    React.useEffect(() => () => { mounted.current = false; }, []);
    const scopeCurrent = areServerAccountScopesEqual(scope, activeScope);
    const isCurrent = () => mounted.current && areServerAccountScopesEqual(scope, getActiveServerAccountScope());
    const run = async (operation: () => Promise<void>) => {
        if (!isCurrent()) { setError(t('sessionTickets.changed')); return; }
        setPending(true); setError(null);
        try { await operation(); }
        catch (cause) { if (mounted.current) { const code = TicketReaderErrorCodeSchema.safeParse(cause instanceof Error ? cause.message : cause); setError(code.success ? t(`sessionTickets.${code.data}`) : t('sessionTickets.provider_error')); } }
        finally { if (mounted.current) setPending(false); }
    };
    const discover = () => run(async () => {
        setSnapshot(null);
        const next = await listSessionTicketSources(scope, machineId, directory);
        if (!isCurrent()) return;
        setSources(next); setSourceId(next.some((source) => source.id === sourceId) ? sourceId : next[0]?.id ?? '');
        if (!next.length) setError(t('sessionTickets.unconfigured'));
    });
    const resolve = () => run(async () => {
        if (!parseSessionTicketUrl(url)) throw new Error('invalid_request');
        const next = await readSessionTicket(scope, { machineId, directory, mcpServerId: sourceId }, url);
        if (isCurrent()) setSnapshot(next);
    });
    const save = (next: SessionTicketAssociationV1 | null) => run(async () => {
        const current = storage.getState().sessions[sessionId];
        if (!current || !deriveTranscriptInteraction({ kind: 'session', accessLevel: current.accessLevel, canApprovePermissions: current.canApprovePermissions }).canSendMessages) throw new Error('access_revoked');
        await sync.patchSessionMetadataWithRetry(sessionId, (metadata) => {
            if (!isCurrent() || JSON.stringify(readSessionTicketAssociation(metadata)) !== JSON.stringify(association)) throw new Error('cancelled');
            return withSessionTicketAssociation(metadata, next);
        }, { serverId: scope.serverId });
        if (isCurrent()) onClose();
    });
    const button = (label: string, testID: string, action: () => void, disabled = false) => <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || pending || !scopeCurrent} onPress={action} style={[styles.button, disabled || pending || !scopeCurrent ? styles.disabled : null]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
    return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="session-ticket-editor">
        <Text style={styles.title}>{t(association ? 'sessionTickets.change' : 'sessionTickets.link')}</Text>
        <Text style={styles.help}>{t('sessionTickets.readerHelp')}</Text>
        {!scopeCurrent ? <Text accessibilityRole="alert" style={styles.error}>{t('sessionTickets.changed')}</Text> : null}
        <Text>{t('sessionTickets.url')}</Text>
        <TextInput testID="session-ticket-url" accessibilityLabel={t('sessionTickets.url')} value={url} editable={!pending && scopeCurrent} onChangeText={(value) => { setUrl(value); setSnapshot(null); }} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        <Text>{t('sessionTickets.machine')}</Text>
        {machines.map((machine) => <React.Fragment key={machine.id}>{button(`${machine.metadata?.displayName || machine.metadata?.host || machine.id}${machine.id === machineId ? ' ✓' : ''}`, `session-ticket-machine:${machine.id}`, () => { setMachineId(machine.id); setSources([]); setSourceId(''); setSnapshot(null); })}</React.Fragment>)}
        <Text>{t('sessionTickets.directory')}</Text>
        <TextInput testID="session-ticket-directory" accessibilityLabel={t('sessionTickets.directory')} value={directory} editable={!pending && scopeCurrent} onChangeText={(value) => { setDirectory(value); setSources([]); setSourceId(''); setSnapshot(null); }} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        {button(t('sessionTickets.sources'), 'session-ticket-sources', () => { void discover(); }, !machineId || !directory.trim())}
        {sources.length ? <Text>{t('sessionTickets.source')}</Text> : null}
        {sources.map((source) => <React.Fragment key={source.id}>{button(`${source.title}${source.id === sourceId ? ' ✓' : ''}`, `session-ticket-source:${source.id}`, () => { setSourceId(source.id); setSnapshot(null); })}</React.Fragment>)}
        {button(t('sessionTickets.resolve'), 'session-ticket-read', () => { void resolve(); }, !sourceId || !url.trim() || !directory.trim())}
        {pending ? <Text accessibilityLiveRegion="polite">{t('sessionTickets.loading')}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {snapshot ? <View testID="session-ticket-resolved"><Text>{`${snapshot.ticket.provider} · ${snapshot.ticket.key} · ${snapshot.ticket.title}`}</Text><Text>{snapshot.ticket.url}</Text><Text>{snapshot.status.name}</Text>{button(t('sessionTickets.save'), 'session-ticket-save', () => { void save({ v: 1, ticket: snapshot.ticket, reader: { machineId, directory, mcpServerId: sourceId } }); })}</View> : null}
        {association ? button(t('sessionTickets.remove'), 'session-ticket-remove', () => { void save(null); }) : null}
        {button(t('common.cancel'), 'session-ticket-cancel', onClose)}
    </ScrollView>;
}
const styles = StyleSheet.create((theme) => ({
    content: { padding: 20, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.primary },
    help: { ...Typography.default(), color: theme.colors.text.secondary },
    input: { ...Typography.default(), borderWidth: 1, borderColor: theme.colors.border.default, color: theme.colors.text.primary, padding: 10, borderRadius: 8 },
    button: { padding: 10, borderRadius: 8, backgroundColor: theme.colors.state.neutral.background },
    buttonText: { ...Typography.default(), color: theme.colors.state.neutral.foreground },
    disabled: { opacity: 0.5 }, error: { color: theme.colors.status.error },
}));
