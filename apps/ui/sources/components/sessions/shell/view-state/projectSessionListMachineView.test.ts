import { describe, expect, it, vi } from 'vitest';

import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { buildSessionListIndexItemFromViewItem } from '@/sync/domains/session/listing/sessionListIndex';
import { buildSessionListDragSource } from '../drop-resolution/buildSessionListDragSource';
import { applySessionListTreeDropOperation } from '../commit/applySessionListTreeDropOperation';
import { buildSessionListTreeRows } from '../drop-resolution/buildSessionListTreeRows';
import { treeRowId } from '../drop-resolution/treeRowId';
import { buildSessionListMoveSheetTargets } from '../move-sheet/buildSessionListMoveSheetTargets';
import { filterCollapsedSessionListItems } from '../sessionListCollapsedItems';
import { filterSessionListItemsByFocusedFolder } from '../sessionFolderShellTypes';
import { filterSessionListItemsForHeaderControls } from '../sessionListFilters';
import { buildSessionListReachabilityModels } from '../sessionListReachabilityModels';
import { projectSessionListMachineView } from './projectSessionListMachineView';

const machines = {
    macA: { id: 'macA', metadata: { displayName: 'Studio Mac' } },
    macB: { id: 'macB', metadata: { displayName: 'Studio Mac' } },
} as unknown as Record<string, MachineDisplayRenderable>;

function header(kind: NonNullable<Extract<SessionListViewItem, { type: 'header' }>['headerKind']>, groupKey: string, serverId?: string): Extract<SessionListViewItem, { type: 'header' }> {
    return { type: 'header', title: groupKey, headerKind: kind, groupKey, serverId };
}

function row(id: string, serverId: string, machineId: string | null, groupKey: string, options?: Partial<Extract<SessionListViewItem, { type: 'session' }>>): SessionListViewItem {
    return {
        type: 'session',
        session: { id, metadata: { machineId, path: '/repo' } } as Extract<SessionListViewItem, { type: 'session' }>['session'],
        serverId,
        groupKey,
        workspace: { t: 'workspaceScope', serverId, machineId, rootPath: '/repo' },
        ...options,
    };
}

function isHeader(item: SessionListViewItem): item is Extract<SessionListViewItem, { type: 'header' }> {
    return item.type === 'header';
}

function isRow(item: SessionListViewItem): item is Extract<SessionListViewItem, { type: 'session' }> {
    return item.type === 'session';
}

describe('projectSessionListMachineView', () => {
    it('groups each session by scoped machine while retaining pinned and section bands', () => {
        const source = [
            header('pinned', 'pinned'),
            row('pinA', 'server1', 'macA', 'pinned', { pinned: true, groupKind: 'pinned' }),
            row('pinB', 'server2', 'macB', 'pinned', { pinned: true, groupKind: 'pinned' }),
            header('active', 'active'),
            { ...header('project', 'project:/repo', 'server1'), workspaceKey: 'known-workspace' },
            row('known', 'server1', 'macA', 'project:/repo', { groupKind: 'project' }),
            row('unknown', 'server1', null, 'project:/repo', { groupKind: 'project' }),
            header('shared', 'shared', 'server2'),
            row('shared', 'server2', 'macB', 'shared', { groupKind: 'shared' }),
            header('inactive', 'inactive'),
            row('inactive', 'server1', 'macA', 'inactive', { section: 'inactive' }),
        ];

        const result = projectSessionListMachineView(source, machines);
        const machineHeaders = result.filter(isHeader).filter((item) => item.headerKind === 'machine');
        expect(machineHeaders.map((item) => [item.serverId, item.machine?.id ?? null])).toEqual([
            ['server1', 'macA'], ['server2', 'macB'],
            ['server1', 'macA'], ['server1', null], ['server2', 'macB'],
            ['server1', 'macA'],
        ]);
        expect(new Set(machineHeaders.map((item) => item.groupKey)).size).toBe(machineHeaders.length);
        expect(machineHeaders.slice(0, 2).map((item) => item.title)).toEqual(['Studio Mac (Server server1)', 'Studio Mac (Server server2)']);
        expect(result.filter(isRow).map((item) => item.session.id)).toEqual([
            'pinA', 'pinB', 'known', 'unknown', 'shared', 'inactive',
        ]);
        const unknownIndex = result.findIndex((item) => item.type === 'session' && item.session.id === 'unknown');
        expect(result[unknownIndex - 1]).toMatchObject({ type: 'header', headerKind: 'project' });
        expect(result[unknownIndex - 1]).toMatchObject({ workspaceScopeHint: null, seedSessionId: 'unknown' });
        const unknownHeader = result[unknownIndex - 1];
        expect(isHeader(unknownHeader) ? unknownHeader.workspaceKey : null).not.toBe('known-workspace');
        expect(result[unknownIndex]).toMatchObject({ serverId: 'server1', workspace: { machineId: null } });
    });

    it('keeps nested folder lineage and original source rows for action targets', () => {
        const folder = { type: 'header', title: 'Tests', headerKind: 'folder', groupKey: 'folder:1', folderId: '1', depth: 0, serverId: 'server1' } as SessionListViewItem;
        const session = row('in-folder', 'server1', 'macA', 'folder:1', { folderId: '1', groupKind: 'folder' });
        const source = [header('active', 'active'), header('project', 'project:/repo', 'server1'), folder, session];
        const result = projectSessionListMachineView(source, machines);
        expect(result.map((item) => item.type === 'header' ? item.headerKind : item.session.id)).toEqual([
            'active', 'machine', 'project', 'folder', 'in-folder',
        ]);
        expect(result.at(-1)).toMatchObject({ session: isRow(session) ? session.session : null, workspace: session.workspace, folderId: '1' });
    });

    it('collapses only the selected machine subtree while keeping the next machine visible', () => {
        const source = [header('active', 'active'), row('one', 'server1', 'macA', 'active'), row('two', 'server1', 'macB', 'active')];
        const projected = projectSessionListMachineView(source, machines);
        expect(projected.filter(isHeader).filter((item) => item.headerKind === 'machine').map((item) => item.title)).toEqual([
            'Studio Mac (macA)', 'Studio Mac (macB)',
        ]);
        const firstMachine = projected.find((item) => item.type === 'header' && item.headerKind === 'machine');
        expect(firstMachine?.groupKey).toBeTruthy();
        const collapsed = filterCollapsedSessionListItems(projected, { [firstMachine!.groupKey!]: true });
        expect(collapsed.filter((item) => item.type === 'session').map((item) => item.session.id)).toEqual(['two']);
        expect(collapsed.filter((item) => item.type === 'header' && item.headerKind === 'machine')).toHaveLength(2);
    });

    it('keeps Active machine collapse scoped when a Pinned band appears earlier', () => {
        const active = [header('active', 'active'), row('active-one', 'server1', 'macA', 'active')];
        const before = projectSessionListMachineView(active, machines);
        const activeMachineKey = before.find((item) => item.type === 'header' && item.headerKind === 'machine')!.groupKey!;
        const after = projectSessionListMachineView([
            header('pinned', 'pinned'),
            row('pinned-one', 'server1', 'macA', 'pinned', { pinned: true, groupKind: 'pinned' }),
            ...active,
        ], machines);
        expect(after.filter(isHeader).filter((item) => item.headerKind === 'machine').map((item) => item.groupKey)).toEqual([
            expect.not.stringMatching(/^$/), activeMachineKey,
        ]);
        expect(filterCollapsedSessionListItems(after, { [activeMachineKey]: true }).filter(isRow).map((item) => item.session.id)).toEqual(['pinned-one']);
    });

    it('keeps the containing machine header in focused folders and omits empty machines during search', () => {
        const folder = {
            type: 'header', title: 'Tests', headerKind: 'folder', groupKey: 'folder:1', folderId: '1', depth: 0,
            workspace: { t: 'workspaceScope', serverId: 'server1', machineId: 'macA', rootPath: '/repo' },
            serverId: 'server1',
        } as SessionListViewItem;
        const source = [
            header('active', 'active'),
            header('project', 'project:/repo', 'server1'),
            folder,
            row('needle', 'server1', 'macA', 'folder:1', { folderId: '1', groupKind: 'folder' }),
            header('project', 'project:/repo-b', 'server1'),
            row('haystack', 'server1', 'macB', 'project:/repo-b', { groupKind: 'project' }),
        ];
        const projected = projectSessionListMachineView(source, machines);
        const focused = filterSessionListItemsByFocusedFolder(projected, '1');
        expect(focused.filter(isHeader).filter((item) => item.headerKind === 'machine').map((item) => item.machine?.id)).toEqual(['macA']);
        const searched = filterSessionListItemsForHeaderControls(projected, {
            searchQuery: 'haystack', selectedTags: [], searchableTextBySessionKey: { 'server1:haystack': 'haystack' }, sessionTags: {},
        });
        expect(searched.filter(isHeader).filter((item) => item.headerKind === 'machine').map((item) => item.machine?.id)).toEqual(['macB']);
        expect(searched.filter((item) => item.type === 'session').map((item) => item.session.id)).toEqual(['haystack']);
    });

    it('does not mutate source rows or original custom order when deriving the alternate view', () => {
        const source = [
            header('pinned', 'pinned'),
            row('pinB', 'server1', 'macB', 'pinned', { pinned: true, groupKind: 'pinned' }),
            row('pinA', 'server1', 'macA', 'pinned', { pinned: true, groupKind: 'pinned' }),
            header('active', 'active'),
            row('second', 'server1', 'macB', 'active'),
            row('first', 'server1', 'macA', 'active'),
        ];
        const originalOrder = source.filter(isRow).map((item) => [item.session.id, item.groupKey]);
        const grouped = projectSessionListMachineView(source, machines);
        expect(grouped.filter(isRow).map((item) => item.session.id)).toEqual(['pinB', 'pinA', 'second', 'first']);
        expect(source.filter(isRow).map((item) => [item.session.id, item.groupKey])).toEqual(originalOrder);
    });

    it('agrees with the canonical row display target when a source workspace is unknown', () => {
        const direct = row('direct', 'server1', null, 'active', {
            session: {
                id: 'direct',
                metadata: {
                    machineId: 'macB',
                    path: '/repo',
                    directSessionV1: { v: 1, providerId: 'codex', machineId: 'macB', remoteSessionId: 'remote' },
                },
            } as unknown as Extract<SessionListViewItem, { type: 'session' }>['session'],
        });
        const source = [
            header('active', 'active'),
            header('project', 'project:/repo', 'server1'),
            { ...header('folder', 'direct-folder', 'server1'), folderId: 'direct-folder', depth: 0, workspace: direct.workspace },
            { ...direct, groupKey: 'direct-folder', folderId: 'direct-folder', groupKind: 'folder' } as SessionListViewItem,
        ];
        const display = buildSessionListReachabilityModels({ items: source, machinesById: machines, workspaceLabelsV1: {} })
            .reachableSessionDisplayByKey.get('server1:direct');
        const machineHeader = projectSessionListMachineView(source, machines).filter(isHeader).find((item) => item.headerKind === 'machine');
        expect(display?.machineId).toBe('macB');
        expect(machineHeader?.machine?.id).toBe(display!.machineId);
        expect(machineHeader?.title).toBe(display!.machineLabel);
        const focused = filterSessionListItemsByFocusedFolder(projectSessionListMachineView(source, machines), 'direct-folder');
        expect(focused.filter(isHeader).map((item) => item.headerKind)).toEqual(['active', 'machine', 'project', 'folder']);
    });

    it('keeps row workspace scope and folder move targets behind machine headers', () => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'server1', machineId: 'macA', rootPath: '/repo' };
        const source = [
            header('pinned', 'pinned'),
            row('pinned', 'server1', 'macA', 'pinned', { workspace, pinned: true, groupKind: 'pinned' }),
            header('active', 'active'),
            { ...header('project', 'project:/repo', 'server1'), workspaceKey: 'project-workspace', workspaceScopeHint: workspace },
            { ...header('folder', 'folder:a', 'server1'), folderId: 'a', depth: 0, workspace },
            row('folder-session', 'server1', 'macA', 'folder:a', { workspace, folderId: 'a', folderDepth: 1, groupKind: 'folder' }),
            { ...header('folder', 'folder:b', 'server1'), folderId: 'b', depth: 0, workspace },
        ] satisfies SessionListViewItem[];
        const projected = projectSessionListMachineView(source, machines);
        const tree = buildSessionListTreeRows({ items: projected.map(buildSessionListIndexItemFromViewItem) });
        expect(tree.rowMetadataById.get(treeRowId.session('server1', 'pinned'))?.workspace).toEqual(workspace);
        const sessionSource = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('server1', 'folder-session') });
        const targets = buildSessionListMoveSheetTargets({ tree, source: sessionSource });
        expect(targets.find((target) => target.kind === 'root')).toMatchObject({
            disabled: false,
            result: { instruction: { kind: 'move-to-root', containerId: treeRowId.workspaceRoot(
                projected.find((item) => item.type === 'header' && item.headerKind === 'project')!.groupKey!,
            ) } },
        });
        expect(targets.find((target) => target.id === 'folder:b')).toMatchObject({ disabled: false });
    });

    it('assigns a session to a folder without persisting synthetic machine-view order keys', async () => {
        const workspace = { t: 'workspaceScope' as const, serverId: 'server1', machineId: 'macA', rootPath: '/repo' };
        const source = [
            header('active', 'active'),
            { ...header('project', 'project:/repo', 'server1'), workspaceKey: 'project-workspace', workspaceScopeHint: workspace },
            { ...header('folder', 'folder:a', 'server1'), folderId: 'a', depth: 0, workspace },
            row('root', 'server1', 'macA', 'project:/repo', { workspace, groupKind: 'project' }),
        ] satisfies SessionListViewItem[];
        const projected = projectSessionListMachineView(source, machines);
        const tree = buildSessionListTreeRows({ items: projected.map(buildSessionListIndexItemFromViewItem) });
        const dragSource = buildSessionListDragSource({ tree, sourceRowId: treeRowId.session('server1', 'root') });
        const setSessionFolderAssignment = vi.fn(async () => {});
        const setSessionListGroupOrderV1 = vi.fn();
        const outcome = await applySessionListTreeDropOperation({
            tree,
            source: dragSource,
            result: {
                instruction: { kind: 'nest-into', targetId: treeRowId.folder('a'), containerId: treeRowId.folder('a'), parentId: treeRowId.folder('a'), depth: 1 },
                visual: { kind: 'outline', targetId: treeRowId.folder('a') },
            },
            context: {
                sessionFoldersV1: { v: 1, folders: [{ id: 'a', workspace, parentId: null, name: 'A', createdAt: 1, updatedAt: 1 }] },
                sessionListGroupOrderV1: {},
                now: () => 1,
                sessionListOrderingModeV1: 'custom',
                structuralWritesEnabled: false,
                setSessionFoldersV1: vi.fn(),
                setSessionListGroupOrderV1,
                setSessionFolderAssignment,
            },
        });
        expect(outcome.ok).toBe(true);
        expect(setSessionFolderAssignment).toHaveBeenCalledWith({ serverId: 'server1', sessionId: 'root', folderId: 'a' });
        expect(setSessionListGroupOrderV1).not.toHaveBeenCalled();
    });
});
