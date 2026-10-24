import { describe, expect, it } from 'vitest';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { buildSessionListSelectedItems } from '../sessionListSelectedItems';
import { buildSessionListIndexFromViewData } from '@/sync/domains/session/listing/sessionListIndex';
import { projectSessionListStatusView, SESSION_LIST_AGENT_STATUS_ORDER } from './projectSessionListStatusView';

type Row = Extract<SessionListViewItem, { type: 'session' }>;
const now = 100_000;
function row(id: string, options: Partial<Row['session']> = {}, fields: Partial<Row> = {}): Row {
    return { type: 'session', serverId: 'home', groupKey: 'project:old', groupKind: 'project',
        session: { ...buildSessionListRenderableFromSession(createSessionFixture({ id, active: true, activeAt: now, presence: 'online', metadata: { path: '/repo', machineId: 'mac' } })), ...options }, ...fields };
}
function header(title: string, headerKind: Extract<SessionListViewItem, { type: 'header' }>['headerKind'] = 'project'): SessionListViewItem {
    return { type: 'header', headerKind, title, groupKey: title };
}
function ids(items: readonly SessionListViewItem[]) { return items.flatMap(item => item.type === 'session' ? [item.session.id] : []); }
function linked(id: string, workspace = 'workspace'): Row {
    const ticket: SessionTicketAssociationV1 = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: workspace, ticketId: id, key: id, title: id, url: `https://linear.app/fixture/issue/DEV-${id}` }, reader: { machineId: 'mac', mcpServerId: 'linear', directory: '/repo' } };
    return row(id, { metadata: { path: '/repo', machineId: 'mac', sessionTicketV1: ticket } });
}
function status(item: Row, name: string, order?: number, workflowId = 'workflow', phase: SessionTicketStatus['phase'] = 'ready'): SessionTicketStatus {
    return { phase, error: null, snapshot: { ticket: item.session.metadata!.sessionTicketV1!.ticket, status: { name, order, workflowId }, fetchedAt: now } };
}

describe('status organization through the canonical sidebar projection', () => {
    it('sorts Agent Status independently and keeps stable/manual ties and existing headers', () => {
        const source = [header('Repository'), row('idle-b'), row('working', { thinking: true, thinkingAt: now }), row('input', { hasPendingPermissionRequests: true }), row('idle-a')];
        const result = projectSessionListStatusView({ items: source, grouping: 'none', sorting: 'agent', ticketStatuses: new Map(), nowMs: now });
        expect(ids(result)).toEqual(['input', 'working', 'idle-b', 'idle-a']);
        expect(result[0]).toBe(source[0]);
        expect(SESSION_LIST_AGENT_STATUS_ORDER).toEqual(['error', 'input', 'delivery_blocked', 'working', 'resuming', 'queued', 'archiving', 'offline', 'idle', 'finished', 'cancelled']);
    });

    it('globally groups unfiled sessions by Agent Status across old machine/repository groups, once per section', () => {
        const source = [header('Pinned', 'pinned'), row('pin', {}, { pinned: true, groupKind: 'pinned' }), header('Sessions', 'sessions'), header('Mac A', 'machine'), header('Repo A'), row('idle-a'), header('Mac B', 'machine'), header('Repo B'), row('working', { thinking: true, thinkingAt: now }), row('idle-b')];
        const result = projectSessionListStatusView({ items: source, grouping: 'agent', sorting: 'none', ticketStatuses: new Map(), nowMs: now });
        expect(ids(result)).toEqual(['pin', 'working', 'idle-a', 'idle-b']);
        expect(result.filter(item => item.type === 'header').map(item => item.title)).toEqual(['Pinned', 'Idle', 'Sessions', 'working...', 'Idle']);
        expect(new Set(ids(result)).size).toBe(ids(source).length);
        expect(result.find(item => item.type === 'session' && item.session.id === 'pin')).toMatchObject({ pinned: true });
        expect(projectSessionListStatusView({ items: source, grouping: 'none', sorting: 'none', ticketStatuses: new Map(), nowMs: now })).toBe(source);
    });

    it('keeps nested physical folder containers and source identity without moving assignments or ranks', () => {
        const folder = { ...header('Tests', 'folder'), folderId: 'tests', parentFolderId: null, depth: 0 };
        const nested = { ...header('Nested', 'folder'), folderId: 'nested', parentFolderId: 'tests', depth: 1 };
        const first = row('first', {}, { folderId: 'tests', folderDepth: 1, groupKind: 'folder' });
        const second = row('second', { thinking: true, thinkingAt: now }, { folderId: 'nested', folderDepth: 2, groupKind: 'folder' });
        const source = [header('Sessions', 'sessions'), header('Repo'), folder, first, nested, second, row('loose')];
        const result = projectSessionListStatusView({ items: source, grouping: 'agent', sorting: 'none', ticketStatuses: new Map(), nowMs: now });
        expect(result).toContain(folder); expect(result).toContain(nested);
        expect(result.find(item => item.type === 'session' && item.session.id === 'first')).toMatchObject({ folderId: 'tests', session: first.session });
        expect(result.find(item => item.type === 'session' && item.session.id === 'second')).toMatchObject({ folderId: 'nested', session: second.session });
        expect(ids(result).sort()).toEqual(['first', 'loose', 'second']);
    });

    it('sorts actual custom ticket workflows without globally comparing unrelated numeric ranks', () => {
        const qa = linked('1'); const prod = linked('2'); const other = linked('3', 'z-workspace'); const unavailable = linked('4');
        const states = new Map([['home:1', status(qa, 'Q/A - Dev', 5)], ['home:2', status(prod, 'Ready for Prod', 9)], ['home:3', status(other, 'Testing', -100)], ['home:4', { phase: 'unavailable' as const, snapshot: null, error: 'unsupported' as const }]]);
        const result = projectSessionListStatusView({ items: [row('unlinked'), other, prod, unavailable, qa], grouping: 'none', sorting: 'ticket', ticketStatuses: states, nowMs: now });
        expect(ids(result)).toEqual(['1', '2', '3', '4', 'unlinked']);
    });

    it('combines Ticket Status groups with Agent Status sorting and preserves selected identity/index on updates', () => {
        const qa1 = linked('1'); const qa2 = linked('2'); const prod = linked('3'); const unavailable = linked('4');
        const states = new Map([['home:1', status(qa1, 'Q/A - Dev', 5)], ['home:2', status(qa2, 'Q/A - Dev', 5)], ['home:3', status(prod, 'Ready for Prod', 9)], ['home:4', { phase: 'unavailable' as const, snapshot: null, error: 'offline' as const }]]);
        const source = [header('Sessions', 'sessions'), qa1, { ...qa2, session: { ...qa2.session, thinking: true, thinkingAt: now } }, prod, unavailable, row('unlinked')];
        const result = projectSessionListStatusView({ items: source, grouping: 'ticket', sorting: 'agent', ticketStatuses: states, nowMs: now });
        expect(ids(result)).toEqual(['2', '1', '3', '4', 'unlinked']);
        expect(result.filter(item => item.type === 'header').map(item => item.title)).toEqual(['Sessions', 'Q/A - Dev', 'Ready for Prod', 'Status unavailable', 'No ticket']);
        const before = buildSessionListSelectedItems({ items: result, pathname: '/session/1', selectable: true });
        states.set('home:1', status(qa1, 'Ready for Prod', 9));
        const moved = projectSessionListStatusView({ items: source, grouping: 'ticket', sorting: 'agent', ticketStatuses: states, nowMs: now });
        const after = buildSessionListSelectedItems({ items: moved, pathname: '/session/1', selectable: true, previousItems: before });
        expect(after?.filter(item => item.type === 'session' && item.selected).map(item => item.type === 'session' && item.session.id)).toEqual(['1']);
        expect(buildSessionListIndexFromViewData(moved)?.filter(item => item.type === 'session').map(item => item.type === 'session' && item.sessionId)).toEqual(ids(moved));
    });

    it('qualifies stale and checking snapshots and separates identical names across workflows', () => {
        const a = linked('1'); const b = linked('2'); const c = linked('3');
        const states = new Map([['home:1', status(a, 'Testing', 1, 'first', 'stale')], ['home:2', status(b, 'Testing', 1, 'second')], ['home:3', status(c, 'Testing', 1, 'second', 'loading')]]);
        const result = projectSessionListStatusView({ items: [a, b, c], grouping: 'ticket', sorting: 'none', ticketStatuses: states, nowMs: now });
        const groups = result.filter(item => item.type === 'header');
        expect(groups.map(item => item.title)).toEqual(['Stale · Testing', 'Checking ticket… · Testing', 'Testing']);
        expect(new Set(groups.map(item => item.groupKey)).size).toBe(3);
    });
});
