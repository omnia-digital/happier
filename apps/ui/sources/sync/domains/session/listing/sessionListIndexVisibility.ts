import type { SessionListIndexItem } from './sessionListIndex';
import { resolveSessionRowForIndexItem, type ResolveSessionListIndexRow } from './sessionListIndexSessionRows';

export type VisibleSessionListSourceState = Readonly<{
    hasArchivedSessionItems: boolean;
    hasInactiveSessionsThatNeedFiltering: boolean;
    hasOrphanHeaders: boolean;
    visiblePlaceholderRows: number;
}>;

type VisibleSessionListHeaderState = {
    pendingSectionHeader: Extract<SessionListIndexItem, { type: 'header' }> | null;
    pendingGroupHeaders: Array<Extract<SessionListIndexItem, { type: 'header' }>>;
};

function createVisibleSessionListHeaderState(): VisibleSessionListHeaderState {
    return {
        pendingSectionHeader: null,
        pendingGroupHeaders: [],
    };
}

function pendingHeadersContainFolder(headers: ReadonlyArray<Extract<SessionListIndexItem, { type: 'header' }>>): boolean {
    return headers.some((item) => item.headerKind === 'folder');
}

function isPrimarySectionHeader(item: Extract<SessionListIndexItem, { type: 'header' }>): boolean {
    return item.headerKind === 'active' || item.headerKind === 'inactive' || item.headerKind === 'sessions';
}

function discardPendingOrphanDateHeaders(headerState: VisibleSessionListHeaderState): void {
    if (!headerState.pendingGroupHeaders.some((item) => item.headerKind === 'date')) return;
    headerState.pendingGroupHeaders = headerState.pendingGroupHeaders.filter((item) => item.headerKind !== 'date');
}

function flushPendingFolderHeaders(params: Readonly<{
    out: SessionListIndexItem[];
    headerState: VisibleSessionListHeaderState;
}>): boolean {
    if (!pendingHeadersContainFolder(params.headerState.pendingGroupHeaders)) return false;
    if (params.headerState.pendingSectionHeader) {
        params.out.push(params.headerState.pendingSectionHeader);
    }
    params.out.push(...params.headerState.pendingGroupHeaders);
    params.headerState.pendingSectionHeader = null;
    params.headerState.pendingGroupHeaders = [];
    return true;
}

export function inspectVisibleSessionListIndexSourceState(
    items: ReadonlyArray<SessionListIndexItem>,
    resolveSessionRow: ResolveSessionListIndexRow,
): VisibleSessionListSourceState {
    let hasArchivedSessionItems = false;
    let hasInactiveSessionsThatNeedFiltering = false;
    let visiblePlaceholderRows = 0;
    let pendingSectionHeader: Extract<SessionListIndexItem, { type: 'header' }> | null = null;
    let pendingGroupHeader: Extract<SessionListIndexItem, { type: 'header' }> | null = null;

    for (const item of items) {
        if (item.type === 'header') {
            if (isPrimarySectionHeader(item)) {
                pendingSectionHeader = item;
                pendingGroupHeader = null;
            } else {
                pendingGroupHeader = item;
            }
            continue;
        }

        pendingSectionHeader = null;
        pendingGroupHeader = null;

        const row = resolveSessionRowForIndexItem(item, resolveSessionRow);
        if (!row) {
            visiblePlaceholderRows += 1;
            continue;
        }

        if (row.metadata == null) {
            visiblePlaceholderRows += 1;
        }

        if (!hasArchivedSessionItems && row.archivedAt != null) {
            hasArchivedSessionItems = true;
        }

        if (
            !hasInactiveSessionsThatNeedFiltering
            && item.section !== 'active'
            && row.active !== true
            && row.keepVisibleWhenInactive !== true
        ) {
            hasInactiveSessionsThatNeedFiltering = true;
        }
    }

    return {
        hasArchivedSessionItems,
        hasInactiveSessionsThatNeedFiltering,
        hasOrphanHeaders: pendingSectionHeader != null || pendingGroupHeader != null,
        visiblePlaceholderRows,
    };
}

export function pruneOrphanSessionListIndexHeaders(items: ReadonlyArray<SessionListIndexItem>): SessionListIndexItem[] {
    const out: SessionListIndexItem[] = [];
    const headerState = createVisibleSessionListHeaderState();

    for (const item of items) {
        if (item.type === 'header') {
            discardPendingOrphanDateHeaders(headerState);
            flushPendingFolderHeaders({ out, headerState });
            if (isPrimarySectionHeader(item)) {
                headerState.pendingSectionHeader = item;
                headerState.pendingGroupHeaders = [];
            } else {
                headerState.pendingGroupHeaders.push(item);
            }
            continue;
        }
        if (headerState.pendingSectionHeader) {
            out.push(headerState.pendingSectionHeader);
            headerState.pendingSectionHeader = null;
        }
        if (headerState.pendingGroupHeaders.length > 0) {
            out.push(...headerState.pendingGroupHeaders);
            headerState.pendingGroupHeaders = [];
        }
        out.push(item);
    }

    flushPendingFolderHeaders({ out, headerState });
    return out;
}

export function filterHiddenInactiveSessionListIndexItems(
    items: ReadonlyArray<SessionListIndexItem>,
    resolveSessionRow: ResolveSessionListIndexRow,
): SessionListIndexItem[] {
    const out: SessionListIndexItem[] = [];
    const headerState = createVisibleSessionListHeaderState();

    for (const item of items) {
        if (item.type === 'header') {
            discardPendingOrphanDateHeaders(headerState);
            flushPendingFolderHeaders({ out, headerState });
            if (isPrimarySectionHeader(item)) {
                headerState.pendingSectionHeader = item;
                headerState.pendingGroupHeaders = [];
            } else {
                headerState.pendingGroupHeaders.push(item);
            }
            continue;
        }
        const row = resolveSessionRowForIndexItem(item, resolveSessionRow);
        const isActive = item.section === 'active' || row?.active === true;
        if (!isActive && item.keepVisibleWhenInactive !== true && row?.keepVisibleWhenInactive !== true) {
            continue;
        }
        if (headerState.pendingSectionHeader) {
            if (
                headerState.pendingSectionHeader.headerKind === 'active'
                || headerState.pendingSectionHeader.headerKind === 'sessions'
            ) {
                out.push(headerState.pendingSectionHeader);
            }
            headerState.pendingSectionHeader = null;
        }
        if (headerState.pendingGroupHeaders.length > 0) {
            out.push(...headerState.pendingGroupHeaders);
            headerState.pendingGroupHeaders = [];
        }
        out.push(item);
    }

    flushPendingFolderHeaders({ out, headerState });
    return out;
}
