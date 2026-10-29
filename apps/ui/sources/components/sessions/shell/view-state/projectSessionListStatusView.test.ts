import { describe, expect, it } from 'vitest';
import type { SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListVisualStatus } from '@/sync/domains/session/listing/deriveSessionListActivity';
import type { SessionTicketStatus } from '@/sync/domains/session/tickets/sessionTicketStatus';
import { buildSessionListSelectedItems } from '../sessionListSelectedItems';
import { buildSessionListIndexFromViewData } from '@/sync/domains/session/listing/sessionListIndex';
import { projectSessionListStatusView } from './projectSessionListStatusView';
import { applySessionFoldersToSessionListViewData, buildSessionListViewData } from '@/sync/domains/session/listing/sessionListViewData';
import { computeVisibleSessionListIndex } from '@/sync/domains/session/listing/computeVisibleSessionListIndex';
import { buildSessionListViewDataFromIndex } from '@/sync/domains/session/listing/sessionListViewDataFromIndex';
import { projectSessionListMachineView } from './projectSessionListMachineView';
import { projectSessionListRepositoryView } from './projectSessionListRepositoryView';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { filterSessionListItemsForHeaderControls } from '../sessionListFilters';
import { filterSessionListItemsByFocusedFolder } from '../sessionFolderShellTypes';
import { filterCollapsedSessionListItems } from '../sessionListCollapsedItems';

type Row = Extract<SessionListViewItem, { type: 'session' }>;
const now = 100_000;
function row(id: string, options: Partial<Row['session']> = {}, fields: Partial<Row> = {}): Row {
    return { type: 'session', serverId: 'home', groupKey: 'project:old', groupKind: 'project',
        session: { ...buildSessionListRenderableFromSession(createSessionFixture({ id, active: true, activeAt: now, presence: 'online', metadata: { path: '/repo', machineId: 'mac', host: 'fixture' } })), ...options }, ...fields };
}
function header(title: string, headerKind: Extract<SessionListViewItem, { type: 'header' }>['headerKind'] = 'project'): SessionListViewItem {
    return { type: 'header', headerKind, title, groupKey: title };
}

it('keeps unknown metadata checking or unavailable instead of claiming No ticket', () => {
    const pending = row('pending', { metadata: null });
    const failed = row('failed', { metadata: null });
    const confirmed = row('confirmed');
    const projected = projectSessionListStatusView({ items: [pending, failed, confirmed], grouping: 'ticket', sorting: 'none', nowMs: now,
        ticketStatuses: new Map([['home:failed', { phase: 'unavailable', snapshot: null, error: null }]]) });
    expect(projected.filter(item => item.type === 'header').map(item => item.title)).toEqual(['Checking ticket…', 'Status unavailable', 'No ticket']);
});
function ids(items: readonly SessionListViewItem[]) { return items.flatMap(item => item.type === 'session' ? [item.session.id] : []); }
function linked(id: string, workspace = 'workspace'): Row {
    const ticket: SessionTicketAssociationV1 = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: workspace, ticketId: id, key: id, title: id, url: `https://linear.app/fixture/issue/DEV-${id}` }, reader: { machineId: 'mac', mcpServerId: 'linear', directory: '/repo' } };
    return row(id, { metadata: { path: '/repo', machineId: 'mac', sessionTicketV1: ticket } });
}
function status(item: Row, name: string, order?: number, workflowId = 'workflow', phase: SessionTicketStatus['phase'] = 'ready'): SessionTicketStatus {
    return { phase, error: null, snapshot: { ticket: item.session.metadata!.sessionTicketV1!.ticket, status: { name, order, workflowId }, fetchedAt: now } };
}

describe('status organization through the canonical sidebar projection', () => {
    it('orders every canonical lifecycle using actual runtime inputs and the badge classifier', () => {
        const states = [
            row('cancelled', { latestTurnStatus: 'cancelled', latestTurnStatusObservedAt: now }),
            row('finished', { latestTurnStatus: 'completed', latestTurnStatusObservedAt: now }),
            row('idle'), row('offline', { active: false, presence: now - 1 }),
            row('archiving', { archiving: true }), row('queued', { pendingCount: 1 }),
            row('resuming', { resumingAt: now }), row('working', { thinking: true, thinkingAt: now }),
            row('delivery_blocked', { pendingCount: 1, pendingBlockedCount: 1 }),
            row('input', { hasPendingPermissionRequests: true }),
            row('error', { latestTurnStatus: 'failed', latestTurnStatusObservedAt: now }),
        ].map(item => ({ ...item, session: { ...item.session, createdAt: 1, meaningfulActivityAt: 1 } }));
        const result = projectSessionListStatusView({ items: states, grouping: 'none', sorting: 'agent', ticketStatuses: new Map(), nowMs: now });
        const expected = ['input', 'finished', 'error', 'queued', 'working', 'idle', 'delivery_blocked', 'resuming', 'archiving', 'offline', 'cancelled'];
        expect(ids(result)).toEqual(expected);
        const grouped = projectSessionListStatusView({ items: states, grouping: 'agent', sorting: 'agent', ticketStatuses: new Map(), nowMs: now });
        expect(ids(grouped)).toEqual(expected);
    });
    it('sorts Agent Status independently and keeps stable/manual ties and existing headers', () => {
        const source = [header('Repository'), row('idle-b'), row('working', { thinking: true, thinkingAt: now }), row('input', { hasPendingPermissionRequests: true }), row('idle-a')];
        const result = projectSessionListStatusView({ items: source, grouping: 'none', sorting: 'agent', ticketStatuses: new Map(), nowMs: now });
        expect(ids(result)).toEqual(['input', 'working', 'idle-b', 'idle-a']);
        expect(result[0]).toBe(source[0]);
    });

    it('moves a session between Agent Status positions when the canonical live status changes', () => {
        const source = [row('first'), row('second')];
        const statuses = new Map<string, SessionListVisualStatus>([['home:first', 'input'], ['home:second', 'working']]);
        const project = () => projectSessionListStatusView({ items: source, grouping: 'none', sorting: 'agent', ticketStatuses: new Map(), nowMs: now, agentStatuses: statuses });
        expect(ids(project())).toEqual(['first', 'second']);
        statuses.set('home:first', 'idle');
        expect(ids(project())).toEqual(['second', 'first']);
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

    it('composes real folder/pin/filter/machine/repository owners and restores their exact saved presentation', () => {
        const rows = [row('assigned'), row('loose'), row('pin'), row('excluded')];
        const sessions = Object.fromEntries(rows.map(item => [item.session.id, item.session]));
        const source = buildSessionListViewData(sessions, {}, { groupInactiveSessionsByProject: true, sectionModeV1: 'single', serverScope: { serverId: 'home' } });
        const workspace = { t: 'workspaceScope' as const, serverId: 'home', machineId: 'mac', rootPath: '/repo' };
        const folders = { v: 1 as const, folders: [{ id: 'planning', workspace, parentId: null, name: 'Planning', createdAt: 1, updatedAt: 1 }] };
        const foldered = applySessionFoldersToSessionListViewData(source, { enabled: true, folders, assignmentsBySessionKey: { 'home:assigned': 'planning' } });
        const sourceIndex = buildSessionListIndexFromViewData(foldered)!;
        const visibleIndex = computeVisibleSessionListIndex({ source: sourceIndex, resolveSessionRow: (_home, id) => sessions[id], hideInactiveSessions: false,
            pinnedSessionKeysV1: ['home:pin'], sessionListGroupOrderV1: {}, presentation: { enabled: false, presentation: 'flat-with-badge' } });
        const visible = buildSessionListViewDataFromIndex({ index: visibleIndex, sourceIndex, source: foldered })!;
        const filtered = filterSessionListItemsForHeaderControls(visible, { searchQuery: '', selectedTags: ['work'], searchableTextBySessionKey: {}, sessionTags: { 'home:assigned': ['work'], 'home:loose': ['work'], 'home:pin': ['work'], 'home:excluded': ['other'] } });
        const scope = { serverId: 'home', accountId: 'account' };
        const associations = { [repositoryWorkspaceKey({ ...scope, machineId: 'mac', path: '/repo' })]: { identity: 'example.com/team/repo', label: 'Repository', rootPath: '/repo', worktreePaths: [] } };
        const machine = projectSessionListMachineView(filtered, {});
        const repository = projectSessionListRepositoryView({ items: filtered, scopes: { home: scope }, associations });
        for (const saved of [machine, repository]) {
            const snapshot = JSON.stringify(saved);
            const grouped = projectSessionListStatusView({ items: saved, grouping: 'agent', sorting: 'none', ticketStatuses: new Map(), nowMs: now });
            expect(new Set(ids(grouped))).toEqual(new Set(['assigned', 'loose', 'pin']));
            expect(ids(grouped)).toHaveLength(3);
            expect(grouped.some(item => item.type === 'header' && item.headerKind === 'pinned')).toBe(true);
            expect(grouped.some(item => item.type === 'header' && (item.headerKind === 'machine' || item.headerKind === 'project'))).toBe(false);
            const assigned = grouped.find(item => item.type === 'session' && item.session.id === 'assigned');
            expect(assigned).toMatchObject({ folderId: 'planning', workspace, session: sessions.assigned });
            const folder = grouped.find(item => item.type === 'header' && item.folderId === 'planning' && item.headerKind === 'folder')!;
            const collapsed = filterCollapsedSessionListItems(grouped, { [folder.groupKey!]: true });
            expect(ids(collapsed)).not.toContain('assigned');
            expect(collapsed.some(item => item.type === 'header' && item.headerKind === 'status' && item.folderId === 'planning')).toBe(false);
            expect(JSON.stringify(saved)).toBe(snapshot);
            expect(projectSessionListStatusView({ items: saved, grouping: 'none', sorting: 'none', ticketStatuses: new Map(), nowMs: now })).toBe(saved);
        }
        const focused = filterSessionListItemsByFocusedFolder(filtered, 'planning');
        expect(ids(projectSessionListStatusView({ items: focused, grouping: 'agent', sorting: 'none', ticketStatuses: new Map(), nowMs: now }))).toEqual(['assigned']);
    });

    it('sorts actual custom ticket workflows without globally comparing unrelated numeric ranks', () => {
        const qa = linked('1'); const prod = linked('2'); const other = linked('3', 'z-workspace'); const unavailable = linked('4');
        const states = new Map([['home:1', status(qa, 'Q/A - Dev', 5)], ['home:2', status(prod, 'Ready for Prod', 9)], ['home:3', status(other, 'Testing', -100)], ['home:4', { phase: 'unavailable' as const, snapshot: null, error: 'unsupported' as const }]]);
        const result = projectSessionListStatusView({ items: [row('unlinked'), other, prod, unavailable, qa], grouping: 'none', sorting: 'ticket', ticketStatuses: states, nowMs: now });
        expect(ids(result)).toEqual(['1', '2', '3', '4', 'unlinked']);
    });

    it('keeps independent provider/workflow scopes deterministic when Agent groups use Ticket sorting', () => {
        const firstWorkflow = linked('1'); const secondWorkflow = linked('2');
        const clickup = linked('3'); const jira = linked('4');
        const clickLink = clickup.session.metadata!.sessionTicketV1!;
        clickup.session.metadata!.sessionTicketV1 = { ...clickLink, ticket: { ...clickLink.ticket, provider: 'clickup', url: 'https://app.clickup.com/t/task3' } };
        const jiraLink = jira.session.metadata!.sessionTicketV1!;
        jira.session.metadata!.sessionTicketV1 = { ...jiraLink, ticket: { ...jiraLink.ticket, provider: 'jira', url: 'https://fixture.atlassian.net/browse/DEV-4' } };
        const states = new Map([['home:1', status(firstWorkflow, 'Testing', 100, 'a')], ['home:2', status(secondWorkflow, 'Testing', -100, 'b')], ['home:3', status(clickup, 'Ready for Prod', 50)], ['home:4', status(jira, 'Q/A - Dev', -500)]]);
        const result = projectSessionListStatusView({ items: [secondWorkflow, jira, firstWorkflow, clickup], grouping: 'agent', sorting: 'ticket', ticketStatuses: states, nowMs: now });
        expect(ids(result)).toEqual(['3', '4', '1', '2']);
        expect(result.filter(item => item.type === 'header').map(item => item.title)).toEqual(['Idle']);
    });

    it('does not compare numeric ranks when the reader has no shared workflow identity', () => {
        const first = linked('1'); const second = linked('2');
        const a = status(first, 'A testing', 100); const z = status(second, 'Z release', -100);
        const states = new Map([['home:1', { ...a, snapshot: { ...a.snapshot!, status: { name: 'A testing', order: 100 } } }], ['home:2', { ...z, snapshot: { ...z.snapshot!, status: { name: 'Z release', order: -100 } } }]]);
        const result = projectSessionListStatusView({ items: [second, first], grouping: 'ticket', sorting: 'ticket', ticketStatuses: states, nowMs: now });
        expect(ids(result)).toEqual(['1', '2']);
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
