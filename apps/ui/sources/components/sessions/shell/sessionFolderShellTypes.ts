import type { SessionListViewItem } from '@/sync/domains/state/storage';
import {
    compareSessionFolderWorkspaceRefs,
    resolveDurableWorkspaceRefForSessionListHeader,
    type SessionFolderViewModeV1,
    type SessionFolderWorkspaceRefV1,
} from '@/sync/domains/session/folders';
export type { SessionFolderViewModeV1, SessionFolderWorkspaceRefV1 };

type SessionListHeaderItemBase = Omit<Extract<SessionListViewItem, { type: 'header' }>, 'headerKind'>;

export type SessionFolderHeaderItem = SessionListHeaderItemBase & Readonly<{
    headerKind: 'folder';
    folderId: string;
    parentFolderId: string | null;
    depth: number;
    sessionCount: number;
    workspace?: SessionFolderWorkspaceRefV1;
    renderWorkspaceKey?: string;
}>;

export type SessionFolderSessionItem = Extract<SessionListViewItem, { type: 'session' }> & Readonly<{
    folderId?: string | null;
    folderDepth?: number;
}>;

export function asSessionFolderHeaderItem(
    item: Extract<SessionListViewItem, { type: 'header' }>,
): SessionFolderHeaderItem | null {
    const candidate = item as Partial<SessionFolderHeaderItem> & { headerKind?: string };
    return candidate.headerKind === 'folder' && typeof candidate.folderId === 'string' && candidate.folderId.trim().length > 0
        ? candidate as SessionFolderHeaderItem
        : null;
}

export function isSessionFolderHeaderItem(
    item: Extract<SessionListViewItem, { type: 'header' }>,
): boolean {
    return asSessionFolderHeaderItem(item) !== null;
}

export function readSessionFolderId(item: Extract<SessionListViewItem, { type: 'session' }>): string | null {
    const folderId = (item as Partial<SessionFolderSessionItem>).folderId;
    return typeof folderId === 'string' && folderId.trim().length > 0 ? folderId.trim() : null;
}

export function readSessionFolderDepth(item: Extract<SessionListViewItem, { type: 'session' }>): number {
    const rawDepth = (item as Partial<SessionFolderSessionItem>).folderDepth;
    return typeof rawDepth === 'number' && Number.isFinite(rawDepth)
        ? Math.max(0, Math.trunc(rawDepth))
        : 0;
}

export function buildSessionFolderBreadcrumbs(
    items: ReadonlyArray<SessionListViewItem>,
    folderId: string | null,
): SessionFolderHeaderItem[] {
    if (!folderId) return [];
    const foldersById = new Map<string, SessionFolderHeaderItem>();
    for (const item of items) {
        if (item.type !== 'header') continue;
        const folder = asSessionFolderHeaderItem(item);
        if (folder) foldersById.set(folder.folderId, folder);
    }

    const out: SessionFolderHeaderItem[] = [];
    const seen = new Set<string>();
    let cursor: string | null = folderId;
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const folder = foldersById.get(cursor);
        if (!folder) break;
        out.push(folder);
        cursor = folder.parentFolderId ?? null;
    }
    out.reverse();
    return out;
}

export function filterSessionListItemsByFocusedFolder(
    items: ReadonlyArray<SessionListViewItem>,
    folderId: string | null,
): SessionListViewItem[] {
    if (!folderId) return [...items];

    const parentByFolderId = new Map<string, string | null>();
    let focusedWorkspace: SessionFolderWorkspaceRefV1 | null = null;
    for (const item of items) {
        if (item.type !== 'header') continue;
        const folder = asSessionFolderHeaderItem(item);
        if (!folder) continue;
        parentByFolderId.set(folder.folderId, folder.parentFolderId ?? null);
        if (folder.folderId === folderId) {
            focusedWorkspace = folder.workspace ?? null;
        }
    }

    const includedFolderIds = new Set<string>([folderId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [candidateId, parentId] of parentByFolderId.entries()) {
            if (!parentId || !includedFolderIds.has(parentId) || includedFolderIds.has(candidateId)) continue;
            includedFolderIds.add(candidateId);
            changed = true;
        }
    }

    const includedMachineGroupKeys = new Set<string>();
    const includedProjectGroupKeys = new Set<string>();
    let currentMachineGroupKey: string | null = null;
    let currentProjectGroupKey: string | null = null;
    for (const item of items) {
        if (item.type === 'header') {
            if (item.headerKind === 'machine') currentMachineGroupKey = item.groupKey ?? null;
            else if (item.headerKind === 'server' || item.headerKind === 'active' || item.headerKind === 'inactive' || item.headerKind === 'sessions' || item.headerKind === 'pinned' || item.headerKind === 'attention' || item.headerKind === 'working') currentMachineGroupKey = null;
            if (item.headerKind === 'project') currentProjectGroupKey = item.groupKey ?? null;
            else if (item.headerKind === 'machine' || item.headerKind === 'server' || item.headerKind === 'active' || item.headerKind === 'inactive' || item.headerKind === 'sessions' || item.headerKind === 'pinned' || item.headerKind === 'attention' || item.headerKind === 'working') currentProjectGroupKey = null;
            const folder = asSessionFolderHeaderItem(item);
            if (folder && includedFolderIds.has(folder.folderId)) {
                if (currentMachineGroupKey) includedMachineGroupKeys.add(currentMachineGroupKey);
                if (currentProjectGroupKey) includedProjectGroupKeys.add(currentProjectGroupKey);
            }
        } else if (readSessionFolderId(item) && includedFolderIds.has(readSessionFolderId(item)!)) {
            if (currentMachineGroupKey) includedMachineGroupKeys.add(currentMachineGroupKey);
            if (currentProjectGroupKey) includedProjectGroupKeys.add(currentProjectGroupKey);
        }
    }

    return items.filter((item) => {
        if (item.type === 'header') {
            const headerKind = String(item.headerKind ?? '');
            if (headerKind === 'active' || headerKind === 'inactive' || headerKind === 'sessions') return true;
            if (headerKind === 'machine') return Boolean(item.groupKey && includedMachineGroupKeys.has(item.groupKey));
            if (headerKind === 'project') {
                if (item.groupKey && includedProjectGroupKeys.has(item.groupKey)) return true;
                if (!focusedWorkspace) return false;
                const workspace = resolveDurableWorkspaceRefForSessionListHeader(item);
                return workspace ? compareSessionFolderWorkspaceRefs(workspace, focusedWorkspace) : false;
            }
            const folder = asSessionFolderHeaderItem(item);
            return folder != null && includedFolderIds.has(folder.folderId);
        }
        const rowFolderId = readSessionFolderId(item);
        return rowFolderId != null && includedFolderIds.has(rowFolderId);
    });
}
