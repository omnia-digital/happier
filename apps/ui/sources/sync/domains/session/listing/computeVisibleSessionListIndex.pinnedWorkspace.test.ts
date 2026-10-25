import { describe, expect, it } from 'vitest';

import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { filterCollapsedSessionListItems } from '@/components/sessions/shell/sessionListCollapsedItems';
import { projectSessionListMachineView } from '@/components/sessions/shell/view-state/projectSessionListMachineView';
import { applySessionFoldersToSessionListViewData, type SessionListViewItem } from './sessionListViewData';
import { buildSessionListIndexItemFromViewItem } from './sessionListIndex';
import { buildSessionListViewDataFromIndex } from './sessionListViewDataFromIndex';
import { computeVisibleSessionListIndex } from './computeVisibleSessionListIndex';

const serverId = 'server-a';
const machineId = 'machine-a';
const machine = {
    id: machineId,
    metadata: { displayName: 'Studio Mac' },
} as MachineDisplayRenderable;
const machines = { [machineId]: machine };
const machineDisplayScopes = {
    '': { serverId, legacyServerIds: [] },
    [serverId]: { serverId, legacyServerIds: [] },
};

function workspace(path: string) {
    return { t: 'workspaceScope' as const, serverId, machineId, rootPath: path };
}

function project(path: string): Extract<SessionListViewItem, { type: 'header' }> {
    return {
        type: 'header',
        headerKind: 'project',
        title: path,
        groupKey: `project:${path}`,
        workspaceKey: path,
        workspaceScopeHint: workspace(path),
        serverId,
        machine,
    };
}

function folder(path: string, id: string): Extract<SessionListViewItem, { type: 'header' }> {
    return {
        type: 'header',
        headerKind: 'folder',
        title: id,
        groupKey: `project:${path}:folder:${id}`,
        folderId: id,
        depth: 0,
        workspace: workspace(path),
        serverId,
    };
}

function session(path: string, id: string, folderId?: string): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session: {
            id,
            active: true,
            archivedAt: null,
            createdAt: 1,
            updatedAt: 1,
            metadata: { machineId, path },
        } as Extract<SessionListViewItem, { type: 'session' }>['session'],
        section: 'active',
        groupKey: folderId ? `project:${path}:folder:${folderId}` : `project:${path}`,
        groupKind: folderId ? 'folder' : 'project',
        folderId: folderId ?? null,
        folderDepth: folderId ? 1 : 0,
        workspace: workspace(path),
        serverId,
    };
}

const activeHeader: SessionListViewItem = {
    type: 'header', headerKind: 'active', title: 'Active', groupKey: 'active', serverId,
};

function projectList(source: SessionListViewItem[], pinnedSessionIds: string[], sectionModeV1?: 'activity' | 'single') {
    const sourceIndex = source.map(buildSessionListIndexItemFromViewItem);
    const byId = new Map(source.flatMap((item) => item.type === 'session' ? [[item.session.id, item.session] as const] : []));
    const index = computeVisibleSessionListIndex({
        source: sourceIndex,
        resolveSessionRow: (_serverId, sessionId) => byId.get(sessionId) ?? null,
        hideInactiveSessions: false,
        pinnedSessionKeysV1: pinnedSessionIds.map((id) => `${serverId}:${id}`),
        sessionListGroupOrderV1: {
            'project:/alpha': ['folder:saved', `${serverId}:alpha`],
            'project:/beta': [`${serverId}:beta`],
        },
        sessionListOrderingModeV1: 'custom',
        sessionListSectionModeV1: sectionModeV1,
        presentation: { enabled: false, presentation: 'grouped' },
    })!;
    const view = buildSessionListViewDataFromIndex({ index, source, sourceIndex })!;
    return { index, view };
}

function describeRows(items: ReadonlyArray<SessionListViewItem>): string[] {
    return items.map((item) => item.type === 'header'
        ? `header:${item.headerKind}:${item.title}`
        : `session:${item.session.id}:${item.groupKind}`);
}

describe('pinned Active workspace projection', () => {
    it('removes only workspaces emptied by pinning and restores their source folder and order on unpin', () => {
        const source = [
            activeHeader,
            project('/alpha'),
            folder('/alpha', 'saved'),
            session('/alpha', 'alpha', 'saved'),
            project('/beta'),
            session('/beta', 'beta'),
        ];

        const allPinned = projectList(source, ['alpha', 'beta']);
        expect(describeRows(allPinned.view)).toEqual([
            'header:pinned:Pinned',
            'session:alpha:pinned',
            'session:beta:pinned',
        ]);
        expect(new Set(allPinned.view.filter((item) => item.type === 'session').map((item) => item.session.id)).size).toBe(2);
        expect(describeRows(projectSessionListMachineView(allPinned.view, machines, {}, undefined, machineDisplayScopes))).toEqual([
            'header:pinned:Pinned',
            'header:machine:Studio Mac',
            'session:alpha:pinned',
            'session:beta:pinned',
        ]);

        const mixed = projectList(source, ['alpha']);
        expect(describeRows(mixed.view)).toEqual([
            'header:pinned:Pinned',
            'session:alpha:pinned',
            'header:active:Active',
            'header:project:/beta',
            'session:beta:project',
        ]);

        const unpinned = projectList(source, []);
        expect(describeRows(unpinned.view)).toEqual([
            'header:active:Active',
            'header:project:/alpha',
            'header:folder:saved',
            'session:alpha:folder',
            'header:project:/beta',
            'session:beta:project',
        ]);
        expect(unpinned.view.find((item) => item.type === 'session' && item.session.id === 'alpha')).toMatchObject({
            folderId: 'saved', workspace: workspace('/alpha'),
        });
    });

    it('removes a pinned-out workspace under the single Sessions section too', () => {
        const source = [
            { ...activeHeader, headerKind: 'sessions' as const, title: 'Sessions', groupKey: 'sessions' },
            project('/alpha'),
            folder('/alpha', 'saved'),
            session('/alpha', 'alpha', 'saved'),
        ];
        expect(describeRows(projectList(source, ['alpha'], 'single').view)).toEqual([
            'header:pinned:Pinned',
            'session:alpha:pinned',
        ]);
        expect(describeRows(projectList(source, [], 'single').view)).toEqual([
            'header:sessions:Sessions',
            'header:project:/alpha',
            'header:folder:saved',
            'session:alpha:folder',
        ]);
    });

    it('keeps saved empty folders in surviving workspaces and valid collapsed machine groups', () => {
        const source = [
            activeHeader,
            project('/alpha'),
            folder('/alpha', 'saved'),
            session('/alpha', 'pinned', 'saved'),
            session('/alpha', 'remaining'),
            project('/beta'),
            folder('/beta', 'empty'),
        ];
        const { view } = projectList(source, ['pinned']);
        const machineView = projectSessionListMachineView(view, machines, {}, undefined, machineDisplayScopes);
        const folderView = applySessionFoldersToSessionListViewData(machineView, {
            enabled: true,
            folders: { v: 1, folders: [{
                id: 'saved', workspace: workspace('/alpha'), parentId: null, name: 'saved', createdAt: 1, updatedAt: 1,
            }, {
                id: 'empty', workspace: workspace('/beta'), parentId: null, name: 'empty', createdAt: 1, updatedAt: 1,
            }] },
            assignmentsBySessionKey: { [`${serverId}:pinned`]: 'saved' },
        });

        expect(describeRows(folderView)).toEqual([
            'header:pinned:Pinned',
            'header:machine:Studio Mac',
            'session:pinned:pinned',
            'header:active:Active',
            'header:machine:Studio Mac',
            'header:project:/alpha',
            'header:folder:saved',
            'session:remaining:project',
            'header:project:/beta',
            'header:folder:empty',
        ]);
        const activeMachine = folderView.find((item) => item.type === 'header' && item.headerKind === 'machine'
            && item.groupKey?.includes('active'))!;
        const collapsed = filterCollapsedSessionListItems(folderView, { [activeMachine.groupKey!]: true });
        expect(collapsed.filter((item) => item.type === 'session').map((item) => item.session.id)).toEqual(['pinned']);
        expect(collapsed.filter((item) => item.type === 'header' && item.headerKind === 'machine')).toHaveLength(2);
    });
});
