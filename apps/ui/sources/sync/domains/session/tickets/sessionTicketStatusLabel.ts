import { t } from '@/text';
import type { SessionTicketStatus } from './sessionTicketStatus';

/** One freshness sentence for row, header and status groups. */
export function resolveSessionTicketStatusLabel(state: SessionTicketStatus): string {
    const name = state.snapshot?.status.name ?? (state.phase === 'loading' ? t('sessionTickets.loading') : t('sessionTickets.unavailable'));
    const qualifier = state.phase === 'stale' ? t('sessionTickets.stale') : state.phase === 'loading' && state.snapshot ? t('sessionTickets.loading') : '';
    return [qualifier, name].filter(Boolean).join(' · ');
}
