import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListVisualStatus } from '@/sync/domains/session/listing/deriveSessionListActivity';
import { createSessionListRowStoreStateSelector, selectSessionListRowStateSnapshot } from '@/sync/store/sessionListRowStateSnapshot';
import { resolveNextSessionRuntimePresentationFreshnessAtMs } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { resolveSessionListRowStatus } from '../row/buildSessionListRowModel';
import { sessionListStatusRowKey } from './projectSessionListStatusView';

/** Reuse the row overlay owner; publish status/association changes rather than row records. */
export function createSessionListStatusInputsSelector(items: readonly SessionListViewItem[], activeServerId: string | null | undefined, now: () => number, includeAgent: boolean) {
    const rows = items.filter((item): item is Extract<SessionListViewItem, { type: 'session' }> => item.type === 'session');
    const selectRows = createSessionListRowStoreStateSelector(rows.map(row => ({ sessionId: row.session.id, serverId: row.serverId })), activeServerId);
    let previous: { agentStatuses: ReadonlyMap<string, SessionListVisualStatus>; ticketAssociations: ReadonlyMap<string, SessionTicketAssociationV1 | null>; nextWakeAt: number | null } | undefined;
    let signature = '';
    let previousInputs: Parameters<typeof selectRows>[0] | undefined;
    let previousAt: number | undefined;
    return (state: Parameters<typeof selectRows>[0]) => {
        const at = includeAgent ? now() : 0;
        if (previous && previousAt === at && previousInputs
            && previousInputs.sessions === state.sessions
            && previousInputs.sessionListRenderables === state.sessionListRenderables
            && previousInputs.sessionMessages === state.sessionMessages
            && previousInputs.sessionPending === state.sessionPending) return previous;
        previousInputs = state; previousAt = at;
        const overlay = selectRows(state);
        const agentStatuses = new Map<string, SessionListVisualStatus>();
        const ticketAssociations = new Map<string, SessionTicketAssociationV1 | null>();
        let nextWakeAt: number | null = null;
        for (const row of rows) {
            const key = sessionListStatusRowKey(row);
            const live = selectSessionListRowStateSnapshot(overlay, { sessionId: row.session.id, serverId: row.serverId });
            const session = live.renderable ?? row.session;
            ticketAssociations.set(key, session.metadata?.sessionTicketV1 ?? null);
            if (includeAgent) {
                const status = resolveSessionListRowStatus({ session: row.session, state: live, nowMs: at });
                agentStatuses.set(key, status.visualStatus);
                const wake = resolveNextSessionRuntimePresentationFreshnessAtMs(status.session, at);
                if (wake !== null) nextWakeAt = nextWakeAt === null ? wake : Math.min(nextWakeAt, wake);
            }
        }
        const nextSignature = JSON.stringify([[...agentStatuses], [...ticketAssociations], nextWakeAt]);
        if (previous && nextSignature === signature) return previous;
        signature = nextSignature;
        previous = { agentStatuses, ticketAssociations, nextWakeAt };
        return previous;
    };
}
