import { describe, expect, it } from 'vitest';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { repositoryWorkspaceKey } from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import { projectSessionListRepositoryView } from './projectSessionListRepositoryView';

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
