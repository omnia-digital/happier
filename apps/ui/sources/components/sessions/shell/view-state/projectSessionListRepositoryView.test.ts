import { describe, expect, it, vi } from 'vitest';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { projectSessionListRepositoryView } from './projectSessionListRepositoryView';

import { buildSessionListIndexFromViewData } from '@/sync/domains/session/listing/sessionListIndex';
import { buildSessionListTreeRows } from '../drop-resolution/buildSessionListTreeRows';
import { buildSessionListDragSource } from '../drop-resolution/buildSessionListDragSource';
import { resolveSessionListInstruction } from '../drop-resolution/resolveSessionListInstruction';
import { applySessionListTreeDropOperation } from '../commit/applySessionListTreeDropOperation';
import { treeRowId } from '../drop-resolution/treeRowId';

const scope = { serverId: 'home', accountId: 'account' };
const scopes = { home: scope };
function row(id: string, machineId: string, path = '/repo'): SessionListViewItem {
    return { type: 'session', serverId: 'home', groupKind: 'project', groupKey: machineId,
        workspace: { t: 'workspaceScope', serverId: 'home', machineId, rootPath: path },
        session: { id, createdAt: 1, updatedAt: 1, metadata: { machineId, path } } as any };
}
const associations = Object.fromEntries(['m1', 'm2'].map(machineId => [repositoryWorkspaceKey({ ...scope, machineId, path: '/repo' }), {
    identity: 'example.com/team/repo', label: 'example.com/team/repo', rootPath: '/repo', worktreePaths: [],
}]));
const band: SessionListViewItem = { type: 'header', headerKind: 'active', title: 'Active', groupKey: 'active' };

describe('repository view projection', () => {
    it('commits cross-checkout display order without erasing Original or Machine ranks or changing physical assignments', async () => {
        const source = [band, row('A', 'm1'), row('A2', 'm1'), row('B', 'm2')];
        const initial = projectSessionListRepositoryView({ items: source, scopes, associations });
        const groupKey = initial.find(item => item.type === 'header' && item.repository)?.groupKey!;
        const tree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(initial)!, rowBoundsById: new Map([
            [treeRowId.workspaceRoot(groupKey), { x: 0, y: 0, width: 320, height: 40 }],
            ...['A', 'A2', 'B'].map((id, index) => [treeRowId.session('home', id), { x: 0, y: 40 + index * 40, width: 320, height: 40 }] as const),
        ]) });
        const drag = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('home', 'B') });
        const result = resolveSessionListInstruction({ tree, source: drag, pointer: { x: 20, y: 82 }, foldersFeatureEnabled: true });
        expect(result.instruction.kind).toBe('reorder-before');
        const setOrder = vi.fn();
        const setFolders = vi.fn();
        const setAssignment = vi.fn(async () => undefined);
        const original = { original: ['home:A', 'home:A2', 'home:B'], machine: ['home:B', 'home:A'], [groupKey]: ['home:A', 'home:A2', 'home:B'] };
        expect(await applySessionListTreeDropOperation({ tree, source: drag, result, context: {
            sessionFoldersV1: { v: 1, folders: [] }, sessionListGroupOrderV1: original, now: () => 100,
            setSessionFoldersV1: setFolders, setSessionListGroupOrderV1: setOrder, setSessionFolderAssignment: setAssignment,
        } })).toMatchObject({ ok: true });
        expect(setAssignment).not.toHaveBeenCalled();
        expect(setFolders).not.toHaveBeenCalled();
        expect(setOrder).toHaveBeenCalledWith({ ...original, [groupKey]: ['home:A', 'home:B', 'home:A2'] });
        const reloaded = JSON.parse(JSON.stringify(setOrder.mock.calls[0][0]));
        expect(projectSessionListRepositoryView({ items: source, scopes, associations, groupOrder: reloaded })
            .filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['A', 'B', 'A2']);
    });

    it('rejects nesting a checkout session into another machine folder within the same repository', async () => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'home', machineId: 'm1', rootPath: '/repo' };
        const folder: SessionListViewItem = { type: 'header', headerKind: 'folder', folderId: 'folder-one', groupKey: 'folder:folder-one', title: 'One', depth: 0, workspace, serverId: 'home' };
        const initial = projectSessionListRepositoryView({ items: [band, folder, row('B', 'm2')], scopes, associations });
        const groupKey = initial.find(item => item.type === 'header' && item.repository)?.groupKey!;
        const tree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(initial)!, rowBoundsById: new Map([
            [treeRowId.workspaceRoot(groupKey), { x: 0, y: 0, width: 320, height: 40 }],
            [treeRowId.folder('folder-one'), { x: 0, y: 40, width: 320, height: 40 }],
            [treeRowId.session('home', 'B'), { x: 0, y: 80, width: 320, height: 40 }],
        ]) });
        const source = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('home', 'B') });
        const result = resolveSessionListInstruction({ tree, source, pointer: { x: 80, y: 60 }, foldersFeatureEnabled: true });
        expect(result.instruction.kind).toBe('blocked');
    });

    it('orders repository headers through organization groups without writing physical workspace order', async () => {
        const splitAssociations = { ...associations, [repositoryWorkspaceKey({ ...scope, machineId: 'm2', path: '/repo' })]: { identity: 'example.com/other/repo', label: 'Other', rootPath: '/repo', worktreePaths: [] } };
        const projected = projectSessionListRepositoryView({ items: [band, row('A', 'm1'), row('B', 'm2')], scopes, associations: splitAssociations });
        const headers = projected.filter((item): item is Extract<SessionListViewItem, { type: 'header' }> => item.type === 'header' && Boolean(item.repository));
        const tree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(projected)!, rowBoundsById: new Map(headers.map((header, index) => [treeRowId.workspaceRoot(header.groupKey!), { x: 0, y: index * 80, width: 320, height: 40 }])) });
        const source = buildSessionListDragSource({ tree, sourceRowId: treeRowId.workspaceRoot(headers[1].groupKey!) });
        const result = resolveSessionListInstruction({ tree, source, pointer: { x: 20, y: 2 }, foldersFeatureEnabled: true });
        expect(result.instruction.kind).toBe('reorder-before');
        const setOrder = vi.fn(); const setWorkspaceOrder = vi.fn();
        expect(await applySessionListTreeDropOperation({ tree, source, result, context: {
            sessionFoldersV1: { v: 1, folders: [] }, sessionListGroupOrderV1: {}, now: () => 100,
            setSessionFoldersV1: vi.fn(), setSessionListGroupOrderV1: setOrder, setSessionWorkspaceOrderV1: setWorkspaceOrder, setSessionFolderAssignment: vi.fn(async () => undefined),
        } })).toMatchObject({ ok: true });
        expect(setWorkspaceOrder).not.toHaveBeenCalled();
        expect(setOrder).toHaveBeenCalledWith({ [headers[0].repository!.orderScope]: [`group:${headers[1].groupKey}`, `group:${headers[0].groupKey}`] });
    });

    it('moves a nested folder back to its real workspace root when dropped beside another checkout folder', async () => {
        const firstWorkspace = { t: 'workspaceScope' as const, serverId: 'home', machineId: 'm1', rootPath: '/repo' };
        const secondWorkspace = { ...firstWorkspace, machineId: 'm2' };
        const folder = (id: string, depth: number, workspace = firstWorkspace): SessionListViewItem => ({ type: 'header', headerKind: 'folder', folderId: id, groupKey: `folder:${id}`, title: id, depth, workspace, serverId: 'home' });
        const projected = projectSessionListRepositoryView({ items: [band, folder('parent', 0), folder('child', 1), folder('other', 0, secondWorkspace)], scopes, associations });
        const groupKey = projected.find(item => item.type === 'header' && item.repository)?.groupKey!;
        const tree = buildSessionListTreeRows({ items: buildSessionListIndexFromViewData(projected)!, rowBoundsById: new Map([
            [treeRowId.workspaceRoot(groupKey), { x: 0, y: 0, width: 320, height: 40 }],
            ...['parent', 'child', 'other'].map((id, index) => [treeRowId.folder(id), { x: 0, y: 40 + index * 40, width: 320, height: 40 }] as const),
        ]) });
        const source = buildSessionListDragSource({ tree, sourceRowId: treeRowId.folder('child') });
        const result = resolveSessionListInstruction({ tree, source, pointer: { x: 20, y: 122 }, foldersFeatureEnabled: true });
        expect(result.instruction.kind).toBe('reorder-before');
        const setFolders = vi.fn();
        expect(await applySessionListTreeDropOperation({ tree, source, result, context: {
            sessionFoldersV1: { v: 1, folders: [
                { id: 'parent', parentId: null, workspace: firstWorkspace, name: 'Parent', createdAt: 1, updatedAt: 1 },
                { id: 'child', parentId: 'parent', workspace: firstWorkspace, name: 'Child', createdAt: 1, updatedAt: 1 },
                { id: 'other', parentId: null, workspace: secondWorkspace, name: 'Other', createdAt: 1, updatedAt: 1 },
            ] }, sessionListGroupOrderV1: {}, now: () => 100,
            setSessionFoldersV1: setFolders, setSessionListGroupOrderV1: vi.fn(), setSessionFolderAssignment: vi.fn(async () => undefined),
        } })).toMatchObject({ ok: true });
        expect(setFolders).toHaveBeenCalledOnce();
        expect(setFolders.mock.calls[0][0].folders.find((entry: { id: string }) => entry.id === 'child')).toMatchObject({ parentId: null, workspace: firstWorkspace });
    });

    it('uses canonical date ordering when selected while retaining the saved custom rank', () => {
        const a = row('A', 'm1'); const b = row('B', 'm2');
        if (a.type !== 'session' || b.type !== 'session') throw new Error('Expected sessions');
        a.session = { ...a.session, createdAt: 1, updatedAt: 1 };
        b.session = { ...b.session, createdAt: 1000, updatedAt: 1000 };
        const source = [band, a, b];
        const first = projectSessionListRepositoryView({ items: source, scopes, associations });
        const groupKey = first.find(item => item.type === 'header' && item.repository)?.groupKey!;
        const order = { [groupKey]: ['home:A', 'home:B'] };
        for (const orderingMode of ['created', 'updated'] as const) {
            expect(projectSessionListRepositoryView({ items: source, scopes, associations, groupOrder: order, orderingMode })
                .filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['B', 'A']);
        }
        expect(projectSessionListRepositoryView({ items: source, scopes, associations, groupOrder: order, orderingMode: 'custom' })
            .filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['A', 'B']);
    });

    it('allows true A/B/A2 session interleaving across checkouts and preserves each physical target', () => {
        const a = row('A', 'm1'); const a2 = row('A2', 'm1'); const b = row('B', 'm2');
        const source = [band, a, a2, b];
        const initial = projectSessionListRepositoryView({ items: source, scopes, associations });
        const repository = initial.find((item): item is Extract<SessionListViewItem, { type: 'header' }> => item.type === 'header' && Boolean(item.repository))!;
        expect(repository).toMatchObject({ headerKind: 'project', repository: { identity: 'example.com/team/repo' } });
        expect(repository.workspace).toBeUndefined();
        expect(repository.workspaceKey).toBeUndefined();
        expect(repository.workspaceScopeHint).toBeUndefined();
        const projected = projectSessionListRepositoryView({ items: source, scopes, associations,
            groupOrder: { [repository.groupKey!]: ['home:A', 'home:B', 'home:A2'] } });
        const rows = projected.filter(item => item.type === 'session');
        expect(rows.map(item => item.session.id)).toEqual(['A', 'B', 'A2']);
        for (const original of [a, b, a2]) {
            if (original.type !== 'session') continue;
            const result = rows.find(item => item.session.id === original.session.id)!;
            expect(result.session).toBe(original.session);
            expect(result.workspace).toBe(original.workspace);
        }
        expect(source).toEqual([band, a, a2, b]);
        const afterActivity = source.map(item => item.type === 'session' ? { ...item, session: { ...item.session, updatedAt: 900 } } : item);
        expect(projectSessionListRepositoryView({ items: afterActivity, scopes, associations, groupOrder: { [repository.groupKey!]: ['home:A', 'home:B', 'home:A2'] } })
            .filter(item => item.type === 'session').map(item => item.session.id)).toEqual(['A', 'B', 'A2']);
    });

    it('keeps empty and nested folders, pins, shared bands and unknown checkouts separate', () => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'home', machineId: 'm1', rootPath: '/repo' };
        const folder: SessionListViewItem = { type: 'header', headerKind: 'folder', title: 'Folder', groupKey: 'folder:one', folderId: 'one', depth: 0, workspace, serverId: 'home' };
        const nested: SessionListViewItem = { ...folder, title: 'Nested', groupKey: 'folder:two', folderId: 'two', parentFolderId: 'one', depth: 1 };
        const pinned = { ...row('pin', 'm1'), pinned: true, groupKind: 'pinned' as const };
        const inside = { ...row('inside', 'm1'), folderId: 'two', folderDepth: 2, groupKind: 'folder' as const, groupKey: 'folder:two' };
        const source: SessionListViewItem[] = [
            { type: 'header', headerKind: 'pinned', title: 'Pinned', groupKey: 'pinned' }, pinned,
            band, folder, nested, inside, row('root', 'm2'),
            { type: 'header', headerKind: 'shared', title: 'Shared', groupKey: 'shared' }, row('shared', 'm2'), row('unknown', 'm3'),
        ];
        const result = projectSessionListRepositoryView({ items: source, scopes, associations });
        expect(result).toContain(folder);
        expect(result).toContain(nested);
        expect(result.find(item => item.type === 'session' && item.session.id === 'inside')).toBe(inside);
        expect(result.filter(item => item.type === 'header' && item.repository)).toHaveLength(4);
        expect(result.filter(item => item.type === 'session').map(item => item.session.id).sort()).toEqual(['inside', 'pin', 'root', 'shared', 'unknown']);
        expect(projectSessionListRepositoryView({ items: [band, folder, nested], scopes, associations })).toContain(nested);
    });
});
