import * as React from 'react';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { createSessionTicketStatusOwner } from '@/sync/domains/session/tickets/sessionTicketStatusOwner';
import { readSessionTicket } from '@/sync/ops/sessionTickets';
import { resolveServerScopedSessionContext, runWithCurrentServerScopedSessionContext } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { subscribeServerProfiles, areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { isRuntimeActive, isHostVisible, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { readHostWindowFocus } from '@/utils/runtime/readHostWindowFocus';

const owner = createSessionTicketStatusOwner((home, link) => {
    if (!isRuntimeActive() || !isHostVisible() || readHostWindowFocus() === false) return Promise.reject(new Error('cancelled'));
    return readSessionTicket(home, link.reader, link.ticket.url);
}, runWithCurrentServerScopedSessionContext);
const LOADING: SessionTicketStatus = Object.freeze({ phase: 'loading', snapshot: null, error: null });
const UNAVAILABLE: SessionTicketStatus = Object.freeze({ phase: 'unavailable', snapshot: null, error: 'access_revoked' });
const EMPTY = new Map<string, SessionTicketStatus>();
export type SessionTicketStatusDemand = Readonly<{ key: string; association: SessionTicketAssociationV1; serverId?: string | null }>;
type Retained = ReturnType<typeof owner.retain>;

/** Demand is independent of row visibility; all consumers retain the same account-scoped entries. */
export function useSessionTicketStatuses(demands: readonly SessionTicketStatusDemand[], enabled = true) {
    const activeScope = useActiveServerAccountScope();
    const demandKey = JSON.stringify(enabled ? [...demands].sort((a, b) => a.key.localeCompare(b.key)) : []);
    const contextKey = JSON.stringify([activeScope?.serverId, activeScope?.accountId, demandKey]);
    const [projection, setProjection] = React.useState<{ contextKey: string; states: ReadonlyMap<string, SessionTicketStatus> }>({ contextKey: '', states: EMPTY });
    const refreshRef = React.useRef<() => Promise<void>>(async () => {});
    React.useEffect(() => {
        const inputs: SessionTicketStatusDemand[] = JSON.parse(demandKey);
        let disposed = false; let revision = 0; let release = () => {};
        const resolve = () => {
            const current = ++revision; release(); release = () => {};
            setProjection({ contextKey, states: EMPTY }); refreshRef.current = async () => {};
            if (inputs.length === 0) return;
            const servers = [...new Set(inputs.map(input => input.serverId ?? ''))];
            void Promise.all(servers.map(async serverId => {
                try { return [serverId, await resolveServerScopedSessionContext({ serverId, preferScoped: true })] as const; }
                catch { return [serverId, null] as const; }
            })).then(contexts => {
                if (disposed || current !== revision) return;
                const byServer = new Map(contexts); const retained = new Map<string, Retained>(); const failures = new Map<string, SessionTicketStatus>();
                for (const input of inputs) {
                    const context = byServer.get(input.serverId ?? '');
                    const valid = context?.scope === 'scoped'
                        && areServerProfileIdentifiersEquivalent(context.targetServerId, input.serverId ?? activeScope?.serverId)
                        && (!activeScope || !areServerProfileIdentifiersEquivalent(context.targetServerId, activeScope.serverId) || context.targetAccountId === activeScope.accountId);
                    if (valid) retained.set(input.key, owner.retain(context, input.association));
                    else failures.set(input.key, UNAVAILABLE);
                }
                const publish = () => {
                    if (disposed || current !== revision) return;
                    setProjection({ contextKey, states: new Map([...failures, ...[...retained].map(([key, value]) => [key, value.entry.getSnapshot()] as const)]) });
                };
                const entries = [...new Set([...retained.values()].map(value => value.entry))];
                const unsubscribeEntries = entries.map(entry => entry.subscribe(publish));
                const refresh = async () => { await Promise.all(entries.map(entry => entry.refresh())); };
                refreshRef.current = refresh;
                const unsubscribeLifecycle = subscribeToRuntimeActiveChange(() => {
                    if (isRuntimeActive() && isHostVisible() && readHostWindowFocus() !== false) void refresh();
                    else entries.forEach(entry => entry.markStale());
                }, { includeWindowFocus: true });
                release = () => { unsubscribeLifecycle(); unsubscribeEntries.forEach(unsubscribe => unsubscribe()); retained.forEach(value => value.release()); };
                publish();
                // A row appearing after list-level discovery reuses its ready snapshot without another read.
                for (const value of retained.values()) if (value.created) void value.entry.refresh();
            });
        };
        resolve();
        const unsubscribeCredentials = TokenStorage.subscribeCredentialChanges(resolve);
        const unsubscribeProfiles = subscribeServerProfiles(resolve);
        return () => { disposed = true; release(); unsubscribeCredentials(); unsubscribeProfiles(); };
    }, [contextKey, demandKey]);
    const refresh = React.useCallback(() => refreshRef.current(), []);
    return { states: projection.contextKey === contextKey ? projection.states : EMPTY, refresh };
}

export function useSessionTicketStatus(association: SessionTicketAssociationV1, serverId?: string | null) {
    const { states, refresh } = useSessionTicketStatuses([{ key: 'ticket', association, serverId }]);
    return { ...(states.get('ticket') ?? LOADING), refresh };
}
