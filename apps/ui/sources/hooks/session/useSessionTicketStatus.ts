import * as React from 'react';
import { AppState, Platform } from 'react-native';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createSessionTicketStatusEntry } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { readSessionTicket } from '@/sync/ops/sessionTickets';
import { resolveServerScopedSessionContext, runWithCurrentServerScopedSessionContext, type ResolvedServerSessionRpcContext } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { subscribeServerProfiles, areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

const entries = new Map<string, { entry: ReturnType<typeof createSessionTicketStatusEntry>; users: number }>();

/** Mounted header/row leaves share one read and one status; no status is written to session metadata. */
export function useSessionTicketStatus(association: SessionTicketAssociationV1, serverId?: string | null) {
    const activeScope = useActiveServerAccountScope();
    const [context, setContext] = React.useState<Extract<ResolvedServerSessionRpcContext, { scope: 'scoped' }> | null>(null);
    const [contextError, setContextError] = React.useState(false);
    React.useEffect(() => {
        let disposed = false;
        let revision = 0;
        const resolve = () => {
            const current = ++revision;
            void resolveServerScopedSessionContext({ serverId, preferScoped: true }).then((next) => {
                if (disposed || current !== revision || next.scope !== 'scoped') return;
                setContext(next); setContextError(false);
            }, () => { if (!disposed && current === revision) { setContext(null); setContextError(true); } });
        };
        resolve();
        const unsubscribeCredentials = TokenStorage.subscribeCredentialChanges(resolve);
        const unsubscribeProfiles = subscribeServerProfiles(resolve);
        return () => { disposed = true; unsubscribeCredentials(); unsubscribeProfiles(); };
    }, [serverId, activeScope?.serverId, activeScope?.accountId]);
    const capturedContext = context && areServerProfileIdentifiersEquivalent(context.targetServerId, serverId ?? activeScope?.serverId)
        && (!activeScope || !areServerProfileIdentifiersEquivalent(context.targetServerId, activeScope.serverId) || context.targetAccountId === activeScope.accountId) ? context : null;
    const scope = capturedContext ? { serverId: capturedContext.targetServerId, accountId: capturedContext.targetAccountId } : null;
    const key = JSON.stringify([scope?.serverId, scope?.accountId, association]);
    const shared = React.useMemo(() => {
        const previous = entries.get(key);
        if (previous) return previous;
        const captured: ServerAccountScope = scope ?? { serverId: '', accountId: '' };
        const next = { entry: createSessionTicketStatusEntry(captured, association, (home, link) => readSessionTicket(home, link.reader, link.ticket.url), () => Boolean(capturedContext), (action) => capturedContext ? runWithCurrentServerScopedSessionContext(capturedContext, action) : Promise.resolve(false)), users: 0 };
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
    return { ...state, ...(contextError ? { phase: 'unavailable' as const, error: 'access_revoked' as const } : {}), refresh: shared.entry.refresh };
}
