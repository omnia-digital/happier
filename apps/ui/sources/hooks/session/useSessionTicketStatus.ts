import * as React from 'react';
import { AppState, Platform } from 'react-native';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createSessionTicketStatusEntry } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { readSessionTicket } from '@/sync/ops/sessionTickets';

const entries = new Map<string, { entry: ReturnType<typeof createSessionTicketStatusEntry>; users: number }>();

/** Mounted header/row leaves share one read and one status; no status is written to session metadata. */
export function useSessionTicketStatus(association: SessionTicketAssociationV1, serverId?: string | null) {
    const activeScope = useActiveServerAccountScope();
    const scope = activeScope && (!serverId || activeScope.serverId === serverId) ? activeScope : null;
    const key = JSON.stringify([scope?.serverId, scope?.accountId, association]);
    const shared = React.useMemo(() => {
        const previous = entries.get(key);
        if (previous) return previous;
        const captured: ServerAccountScope = scope ?? { serverId: '', accountId: '' };
        const next = { entry: createSessionTicketStatusEntry(captured, association, (home, link) => readSessionTicket(home, link.reader, link.ticket.url), () => areServerAccountScopesEqual(captured, getActiveServerAccountScope())), users: 0 };
        entries.set(key, next);
        return next;
    }, [key]);
    const state = React.useSyncExternalStore(shared.entry.subscribe, shared.entry.getSnapshot, shared.entry.getSnapshot);
    React.useEffect(() => {
        shared.users++;
        void shared.entry.refresh();
        const refresh = () => { void shared.entry.refresh(); };
        const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') refresh(); else shared.entry.markStale(); });
        const blur = () => shared.entry.markStale();
        if (Platform.OS === 'web' && typeof window !== 'undefined') { window.addEventListener('focus', refresh); window.addEventListener('blur', blur); }
        return () => {
            subscription.remove();
            if (Platform.OS === 'web' && typeof window !== 'undefined') { window.removeEventListener('focus', refresh); window.removeEventListener('blur', blur); }
            if (--shared.users === 0) entries.delete(key);
        };
    }, [key, shared]);
    return { ...state, refresh: shared.entry.refresh };
}
