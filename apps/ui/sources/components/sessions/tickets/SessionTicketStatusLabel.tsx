import React from 'react';
import { View, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';
import { t } from '@/text';
import type { SessionTicketIdentityV1 } from '@happier-dev/protocol';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
export function SessionTicketStatusLabel({ ticket, state, testID }: { ticket: SessionTicketIdentityV1; state: SessionTicketStatus; testID: string }) {
    const [active, setActive] = React.useState(false);
    const anchorRef = React.useRef<View | null>(null);
    const statusName = state.snapshot?.status.name ?? (state.phase === 'loading' ? t('sessionTickets.loading') : t('sessionTickets.unavailable'));
    const qualifier = state.phase === 'stale' ? t('sessionTickets.stale') : state.phase === 'loading' && state.snapshot ? t('sessionTickets.loading') : '';
    // The freshness qualifier leads so truncating a long custom workflow name cannot hide it.
    const label = [qualifier, statusName].filter(Boolean).join(' · ');
    const detail = [ticket.provider, ticket.key, state.snapshot?.ticket.title ?? ticket.title, label, state.error ? t(`sessionTickets.${state.error}`) : '', state.snapshot ? `${t('sessionTickets.verified')}: ${new Date(state.snapshot.fetchedAt).toLocaleString()}` : ''].filter(Boolean).join(' · ');
    return <View ref={anchorRef} style={styles.label} testID={testID} accessible accessibilityLabel={detail}
        tabIndex={Platform.OS === 'web' ? 0 : undefined}
        onPointerEnter={() => setActive(true)} onPointerLeave={() => setActive(false)} onFocus={() => setActive(true)} onBlur={() => setActive(false)}>
        <StatusPill variant={state.phase === 'stale' || state.phase === 'unavailable' ? 'warning' : 'neutral'} label={label} labelVariant="phrase" labelNumberOfLines={1} hideDot style={styles.label} />
        {active && Platform.OS === 'web' ? <DeferredAnchoredTooltip activationKey="ticket" anchorRef={anchorRef} label={detail} /> : null}
    </View>;
}
const styles = StyleSheet.create(() => ({ label: { minWidth: 0, flexShrink: 1, maxWidth: '100%' } }));
