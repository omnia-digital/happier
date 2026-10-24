import { SessionTicketSnapshotV1Schema, TicketReaderErrorCodeSchema, type SessionTicketAssociationV1, type SessionTicketSnapshotV1, type TicketReaderErrorCode } from '@happier-dev/protocol';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export type TicketReaderTransport = (scope: ServerAccountScope, association: SessionTicketAssociationV1) => Promise<unknown>;
export type SessionTicketStatus = Readonly<{ phase: 'loading' | 'ready' | 'stale' | 'unavailable'; snapshot: SessionTicketSnapshotV1 | null; error: TicketReaderErrorCode | null }>;
export function createSessionTicketStatusEntry(scope: ServerAccountScope, association: SessionTicketAssociationV1, transport: TicketReaderTransport, isCurrent: () => boolean, commitIfCurrent = async (action: () => void) => { if (!isCurrent()) return false; action(); return true; }) {
    let state: SessionTicketStatus = { phase: 'loading', snapshot: null, error: null };
    let inFlight: Promise<void> | null = null;
    const listeners = new Set<() => void>();
    const publish = (next: SessionTicketStatus) => { state = next; for (const listener of listeners) listener(); };
    const refresh = (): Promise<void> => {
        if (inFlight) return inFlight;
        if (!isCurrent()) return Promise.resolve();
        publish({ ...state, phase: 'loading', error: null });
        inFlight = (async () => {
            try {
                const snapshot = SessionTicketSnapshotV1Schema.parse(await transport(scope, association));
                const before = association.ticket;
                const after = snapshot.ticket;
                if (before.provider !== after.provider || before.workspaceId !== after.workspaceId || before.ticketId !== after.ticketId) throw new Error('identity_mismatch');
                await commitIfCurrent(() => publish({ phase: 'ready', snapshot, error: null }));
            } catch (error) {
                const parsed = TicketReaderErrorCodeSchema.safeParse(error instanceof Error ? error.message : error);
                await commitIfCurrent(() => publish({ phase: state.snapshot ? 'stale' : 'unavailable', snapshot: state.snapshot, error: parsed.success ? parsed.data : 'provider_error' }));
            } finally { inFlight = null; }
        })();
        return inFlight;
    };
    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        refresh,
        markStale: () => { if (state.snapshot && state.phase === 'ready') publish({ ...state, phase: 'stale' }); },
    };
}
