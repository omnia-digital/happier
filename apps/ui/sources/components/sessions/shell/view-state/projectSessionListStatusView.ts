import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListVisualStatus } from '@/sync/domains/session/listing/deriveSessionListActivity';
import { resolveSessionListRowStatus } from '../row/buildSessionListRowModel';
import { resolveSessionRowStatusLabel } from '../row/SessionRowStatusBadge';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { resolveSessionTicketStatusLabel } from '@/sync/domains/session/tickets/sessionTicketStatusLabel';
import { t } from '@/text';

export type SessionListStatusMode = 'none' | 'agent' | 'ticket';
export const SESSION_LIST_AGENT_STATUS_ORDER = ['input', 'finished', 'error', 'queued', 'working', 'idle', 'delivery_blocked', 'resuming', 'archiving', 'offline', 'cancelled'] as const satisfies readonly SessionListVisualStatus[];
type Row = Extract<SessionListViewItem, { type: 'session' }>;
type Header = Extract<SessionListViewItem, { type: 'header' }>;
type StatusKey = { identity: string; title: string; scope: readonly string[]; order: number; name: string; freshness: number };
const BANDS = new Set(['server', 'active', 'inactive', 'sessions', 'pinned', 'attention', 'working', 'shared']);
const LOADING: SessionTicketStatus = { phase: 'loading', snapshot: null, error: null };
export function sessionListStatusRowKey(row: Row): string { return `${row.serverId ?? ''}:${row.session.id}`; }

function agentKey(row: Row, nowMs: number, liveStatuses?: ReadonlyMap<string, SessionListVisualStatus>): StatusKey {
    const status = liveStatuses?.get(sessionListStatusRowKey(row)) ?? resolveSessionListRowStatus({ session: row.session, nowMs }).visualStatus;
    return { identity: status, title: resolveSessionRowStatusLabel(status), scope: [], order: SESSION_LIST_AGENT_STATUS_ORDER.indexOf(status), name: '', freshness: 0 };
}
function ticketKey(row: Row, states: ReadonlyMap<string, SessionTicketStatus>, associations?: ReadonlyMap<string, SessionTicketAssociationV1 | null | undefined>): StatusKey {
    const rowKey = sessionListStatusRowKey(row);
    const association = associations?.has(rowKey) ? associations.get(rowKey) : row.session.metadata?.sessionTicketV1;
    const metadataUnknown = associations?.has(rowKey) ? associations.get(rowKey) === undefined : row.session.metadata == null;
    if (!association && !metadataUnknown) return { identity: 'unlinked', title: t('sessionsList.statusOrganization.noTicket'), scope: ['2'], order: 0, name: '', freshness: 0 };
    const state = states.get(sessionListStatusRowKey(row)) ?? LOADING;
    const snapshot = state.snapshot;
    const title = resolveSessionTicketStatusLabel(state);
    if (!snapshot) return { identity: state.phase === 'loading' ? 'loading' : 'unavailable', title, scope: ['1'], order: 0, name: title, freshness: 0 };
    const scope = ['0', snapshot.ticket.provider, snapshot.ticket.workspaceId, snapshot.status.workflowId ?? ''];
    return { identity: JSON.stringify([scope, snapshot.status.id ?? snapshot.status.name, state.phase]), title, scope,
        // A rank without a workflow identity cannot be compared to another ticket's rank.
        order: snapshot.status.workflowId ? snapshot.status.order ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY, name: snapshot.status.name,
        freshness: state.phase === 'loading' ? 0 : state.phase === 'ready' ? 1 : 2 };
}
/** A folder id scopes a row only under that folder's header: pinned and promoted rows keep theirs but form one list. */
function headedFolderId(row: Row, headedFolders: ReadonlySet<string>): string | null {
    return row.folderId && headedFolders.has(row.folderId) ? row.folderId : null;
}
function compare(left: StatusKey, right: StatusKey): number {
    for (let i = 0; i < Math.max(left.scope.length, right.scope.length); i++) {
        const order = (left.scope[i] ?? '').localeCompare(right.scope[i] ?? ''); if (order) return order;
    }
    return (left.order === right.order ? 0 : left.order < right.order ? -1 : 1)
        || left.name.localeCompare(right.name) || left.freshness - right.freshness || left.identity.localeCompare(right.identity);
}

/** Presentation only: retain source row/session identity and every physical organization field. */
export function projectSessionListStatusView(input: Readonly<{
    items: readonly SessionListViewItem[]; grouping: SessionListStatusMode; sorting: SessionListStatusMode;
    ticketStatuses: ReadonlyMap<string, SessionTicketStatus>; nowMs: number;
    agentStatuses?: ReadonlyMap<string, SessionListVisualStatus>;
    ticketAssociations?: ReadonlyMap<string, SessionTicketAssociationV1 | null | undefined>;
}>): SessionListViewItem[] {
    if (input.grouping === 'none' && input.sorting === 'none') return input.items as SessionListViewItem[];
    const agentKeys = new Map<Row, StatusKey>(); const ticketKeys = new Map<Row, StatusKey>();
    const keyFor = (row: Row, mode: Exclude<SessionListStatusMode, 'none'>) => {
        const keys = mode === 'agent' ? agentKeys : ticketKeys;
        let key = keys.get(row); if (!key) { key = mode === 'agent' ? agentKey(row, input.nowMs, input.agentStatuses) : ticketKey(row, input.ticketStatuses, input.ticketAssociations); keys.set(row, key); }
        return key;
    };
    // Stable array sorting keeps saved/manual sibling order when statuses tie.
    const sortRows = (rows: Row[]) => input.sorting === 'none' ? rows
        : rows.sort((a, b) => compare(keyFor(a, input.sorting as 'agent' | 'ticket'), keyFor(b, input.sorting as 'agent' | 'ticket')));
    if (input.grouping === 'none') {
        // Same shape as sortSessionListIndexItemsByOrderingMode: each scope sorts across its own slots,
        // so saved blocks stay in place. Any non-folder header ends every open scope.
        const out = [...input.items]; const headedFolders = new Set<string>(); const scopes = new Map<string | null, number[]>();
        const flush = () => {
            for (const slots of scopes.values()) {
                const sorted = sortRows(slots.map(slot => out[slot] as Row));
                slots.forEach((slot, position) => { out[slot] = sorted[position]; });
            }
            scopes.clear(); headedFolders.clear();
        };
        input.items.forEach((item, slot) => {
            if (item.type === 'header') {
                if (item.headerKind !== 'folder') flush();
                else if (item.folderId) headedFolders.add(item.folderId);
                return;
            }
            const scope = headedFolderId(item, headedFolders);
            const slots = scopes.get(scope) ?? []; slots.push(slot); scopes.set(scope, slots);
        });
        flush(); return out;
    }
    const output: SessionListViewItem[] = []; let band: Header | null = null; let body: SessionListViewItem[] = [];
    const flushBand = () => {
        if (band) output.push(band);
        const bandKey = JSON.stringify([band?.headerKind ?? '', band?.serverId ?? '', band?.groupKey ?? '']);
        const emitGroups = (rows: Row[], container: string, folderId?: string) => {
            const groups = new Map<string, { key: StatusKey; rows: Row[] }>();
            for (const row of rows) { const key = keyFor(row, input.grouping as 'agent' | 'ticket'); const group = groups.get(key.identity) ?? { key, rows: [] }; group.rows.push(row); groups.set(key.identity, group); }
            for (const { key, rows: members } of [...groups.values()].sort((a, b) => compare(a.key, b.key))) {
                const groupKey = `status-view:${JSON.stringify([bandKey, container, input.grouping, key.identity])}`;
                output.push({ type: 'header', headerKind: 'status', title: key.title, groupKey, folderId, subtitle: input.grouping === 'ticket' && key.scope[0] === '0' ? key.scope.slice(1).filter(Boolean).join(' · ') : undefined });
                output.push(...sortRows(members).map(row => ({ ...row, groupKey })));
            }
        };
        const folders = body.filter((item): item is Header => item.type === 'header' && item.headerKind === 'folder');
        const headedFolders = new Set(folders.flatMap(folder => folder.folderId ? [folder.folderId] : []));
        const members = new Map<string, Row[]>(); const loose: Row[] = [];
        for (const item of body) if (item.type === 'session') {
            const folderId = headedFolderId(item, headedFolders);
            if (folderId) { const rows = members.get(folderId) ?? []; rows.push(item); members.set(folderId, rows); } else loose.push(item);
        }
        for (const folder of folders) { output.push(folder); emitGroups(members.get(folder.folderId ?? '') ?? [], folder.groupKey ?? folder.folderId ?? '', folder.folderId); members.delete(folder.folderId ?? ''); }
        emitGroups(loose, 'unfiled');
    };
    for (const item of input.items) { if (item.type === 'header' && BANDS.has(item.headerKind ?? '')) { flushBand(); band = item; body = []; } else body.push(item); }
    flushBand(); return output;
}
