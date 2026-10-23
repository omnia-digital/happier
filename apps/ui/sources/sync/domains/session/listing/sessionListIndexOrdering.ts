import type { SessionListIndexItem } from './sessionListIndex';
import {
    normalizeSessionListFolderSortModeV1,
    type SessionListFolderSortModeV1,
} from './sessionListFolderSortMode';
import { normalizeSessionListKeyParts } from './sessionListKeyNormalization';
import { normalizeTrimmedString } from './normalizeTrimmedString';
import { resolveSessionRowForIndexItem, type ResolveSessionListIndexRow } from './sessionListIndexSessionRows';
import { resolveProjectGroupKey } from './sessionListOrderingStateV1';
import {
    buildSessionListSessionOrderingKey,
    compareSessionListSessionOrderingKeys,
    normalizeSessionListOrderingSectionMode,
    resolveEffectiveSessionListOrderingModeForGroup,
    type SessionListOrderingModeV1,
    type SessionListOrderingSectionMode,
    type SessionListSessionOrderingKey,
} from './sessionListOrderingRules';

export type { SessionListOrderingModeV1 } from './sessionListOrderingRules';

type SessionItem = Extract<SessionListIndexItem, { type: 'session' }>;
type SessionOrderingContext = Readonly<{
    groupKey: string;
    scopeKey: string;
    effectiveMode: SessionListOrderingModeV1;
}>;
type SessionOrderingContextOptions = Readonly<{
    sectionMode?: SessionListOrderingSectionMode;
}>;

function resolveOrderingContextForSessionItem(
    item: SessionItem,
    orderingMode: SessionListOrderingModeV1,
    options: SessionOrderingContextOptions = {},
): SessionOrderingContext | null {
    const groupKey = normalizeTrimmedString(item.groupKey);
    if (!groupKey) return null;
    const sectionMode = normalizeSessionListOrderingSectionMode(options.sectionMode);
    const section = sectionMode === 'single' ? 'sessions' : item.section;
    const effectiveMode = resolveEffectiveSessionListOrderingModeForGroup({
        section,
        sectionMode,
        groupKind: item.groupKind,
        userOrderingMode: orderingMode,
    });
    return {
        groupKey,
        scopeKey: `${sectionMode}:${section ?? 'unknown'}:${groupKey}`,
        effectiveMode,
    };
}

function resolveSessionOrderingScopeKey(
    item: SessionItem,
    orderingMode: SessionListOrderingModeV1,
    options: SessionOrderingContextOptions = {},
): string | null {
    return resolveOrderingContextForSessionItem(item, orderingMode, options)?.scopeKey ?? null;
}

function resolveCustomSessionOrderingContext(
    item: SessionItem,
    options: SessionOrderingContextOptions = {},
): SessionOrderingContext | null {
    const context = resolveOrderingContextForSessionItem(item, 'custom', options);
    return context?.effectiveMode === 'custom' ? context : null;
}

function buildOrderingKeyCache(
    sessions: ReadonlyArray<SessionItem>,
    resolveSessionRow: ResolveSessionListIndexRow,
): Map<SessionItem, SessionListSessionOrderingKey> {
    const cache = new Map<SessionItem, SessionListSessionOrderingKey>();
    for (const item of sessions) {
        cache.set(item, buildSessionListSessionOrderingKey({
            item,
            row: resolveSessionRowForIndexItem(item, resolveSessionRow),
        }));
    }
    return cache;
}

function compareSessionItemsByOrderingKey(
    a: SessionItem,
    b: SessionItem,
    orderingMode: SessionListOrderingModeV1,
    keyCache: ReadonlyMap<SessionItem, SessionListSessionOrderingKey>,
): number {
    const keyA = keyCache.get(a);
    const keyB = keyCache.get(b);
    if (!keyA || !keyB) return 0;
    return compareSessionListSessionOrderingKeys(keyA, keyB, orderingMode);
}

function isSessionListIndexItemsAlreadyOrderedByOrderingMode(
    source: ReadonlyArray<SessionListIndexItem>,
    orderingMode: SessionListOrderingModeV1,
    resolveSessionRow: ResolveSessionListIndexRow,
    options: SessionOrderingContextOptions = {},
): boolean {
    const lastSessionByScopeKey = new Map<string, SessionItem>();
    const keyCache = new Map<SessionItem, SessionListSessionOrderingKey>();

    for (const item of source) {
        if (item.type !== 'session') continue;

        const context = resolveOrderingContextForSessionItem(item, orderingMode, options);
        if (!context || context.effectiveMode === 'custom') continue;
        keyCache.set(item, buildSessionListSessionOrderingKey({
            item,
            row: resolveSessionRowForIndexItem(item, resolveSessionRow),
        }));

        const previous = lastSessionByScopeKey.get(context.scopeKey);
        if (previous && compareSessionItemsByOrderingKey(previous, item, context.effectiveMode, keyCache) > 0) {
            return false;
        }

        lastSessionByScopeKey.set(context.scopeKey, item);
    }

    return lastSessionByScopeKey.size > 0;
}

export function sortSessionListIndexItemsByOrderingMode(
    source: ReadonlyArray<SessionListIndexItem>,
    orderingMode: SessionListOrderingModeV1,
    resolveSessionRow: ResolveSessionListIndexRow,
    options: SessionOrderingContextOptions = {},
): SessionListIndexItem[] {
    if (isSessionListIndexItemsAlreadyOrderedByOrderingMode(source, orderingMode, resolveSessionRow, options)) {
        return source as SessionListIndexItem[];
    }

    const sessionsByScopeKey = new Map<string, SessionItem[]>();
    const effectiveModeByScopeKey = new Map<string, SessionListOrderingModeV1>();
    for (const item of source) {
        if (item.type !== 'session') continue;
        const context = resolveOrderingContextForSessionItem(item, orderingMode, options);
        if (!context || context.effectiveMode === 'custom') continue;
        if (!sessionsByScopeKey.has(context.scopeKey)) {
            sessionsByScopeKey.set(context.scopeKey, []);
            effectiveModeByScopeKey.set(context.scopeKey, context.effectiveMode);
        }
        sessionsByScopeKey.get(context.scopeKey)!.push(item);
    }

    const sortedByScopeKey = new Map<string, SessionItem[]>();
    for (const [scopeKey, sessions] of sessionsByScopeKey.entries()) {
        if (sessions.length < 2) continue;
        const effectiveMode = effectiveModeByScopeKey.get(scopeKey) ?? orderingMode;
        const keyCache = buildOrderingKeyCache(sessions, resolveSessionRow);
        const next = [...sessions].sort((a, b) => compareSessionItemsByOrderingKey(a, b, effectiveMode, keyCache));
        sortedByScopeKey.set(scopeKey, next);
    }

    if (sortedByScopeKey.size === 0) {
        return source as SessionListIndexItem[];
    }

    const indicesByScopeKey = new Map<string, number>();
    const out: SessionListIndexItem[] = [];
    let didChange = false;
    for (const item of source) {
        if (item.type !== 'session') {
            out.push(item);
            continue;
        }
        const scopeKey = resolveSessionOrderingScopeKey(item, orderingMode, options);
        if (!scopeKey) {
            out.push(item);
            continue;
        }
        const replacementList = sortedByScopeKey.get(scopeKey);
        if (!replacementList) {
            out.push(item);
            continue;
        }
        const index = indicesByScopeKey.get(scopeKey) ?? 0;
        const replacement = replacementList[index] ?? item;
        if (replacement !== item) {
            didChange = true;
        }
        out.push(replacement);
        indicesByScopeKey.set(scopeKey, index + 1);
    }

    return didChange ? out : (source as SessionListIndexItem[]);
}

export function reorderSessionListIndexSessionItemsByKeys(
    items: ReadonlyArray<Extract<SessionListIndexItem, { type: 'session' }>>,
    keys: ReadonlyArray<string> | undefined,
): Array<Extract<SessionListIndexItem, { type: 'session' }>> {
    if (!keys || keys.length === 0 || items.length < 2) {
        return [...items];
    }

    const byKey = new Map<string, Extract<SessionListIndexItem, { type: 'session' }>>();
    for (const item of items) {
        const key = normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
        if (key) byKey.set(key, item);
    }

    const out: Array<Extract<SessionListIndexItem, { type: 'session' }>> = [];
    const used = new Set<Extract<SessionListIndexItem, { type: 'session' }>>();

    for (const key of keys) {
        const normalized = typeof key === 'string' ? key.trim() : '';
        if (!normalized) continue;
        const found = byKey.get(normalized);
        if (found && !used.has(found)) {
            out.push(found);
            used.add(found);
        }
    }

    const unordered = items.filter((item) => !used.has(item));
    return [...unordered, ...out];
}

function buildFolderOrderKey(folderIdRaw: unknown): string | null {
    const folderId = typeof folderIdRaw === 'string' ? folderIdRaw.trim() : '';
    return folderId ? `folder:${folderId}` : null;
}

function buildListItemOrderKey(item: SessionListIndexItem): string | null {
    if (item.type === 'session') {
        return normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
    }
    if (item.headerKind === 'folder') {
        return buildFolderOrderKey(item.folderId);
    }
    return null;
}

function readFolderDepth(item: SessionListIndexItem): number {
    const depth = item.folderDepth;
    return typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, Math.trunc(depth)) : 0;
}

function resolveFolderParentGroupKeyFromVisibleItems(params: Readonly<{
    items: ReadonlyArray<SessionListIndexItem>;
    itemIndex: number;
    folder: Extract<SessionListIndexItem, { type: 'header' }>;
}>): string | null {
    const depth = readFolderDepth(params.folder);
    const projectGroupKey = resolveProjectGroupKey(params.folder.groupKey);
    if (depth <= 0) return projectGroupKey || null;
    for (let index = params.itemIndex - 1; index >= 0; index -= 1) {
        const candidate = params.items[index];
        if (candidate?.type !== 'header' || candidate.headerKind !== 'folder') continue;
        if (readFolderDepth(candidate) < depth) {
            return String(candidate.groupKey ?? '').trim() || null;
        }
    }
    return projectGroupKey || null;
}

function isInsideFolderBlock(item: SessionListIndexItem, folderDepth: number): boolean {
    if (item.type === 'session') {
        return readFolderDepth(item) > folderDepth;
    }
    return item.headerKind === 'folder' && readFolderDepth(item) > folderDepth;
}

function findFolderBlockEnd(items: ReadonlyArray<SessionListIndexItem>, startIndex: number, folderDepth: number): number {
    let cursor = startIndex + 1;
    while (cursor < items.length && isInsideFolderBlock(items[cursor]!, folderDepth)) {
        cursor += 1;
    }
    return cursor;
}

type ChildOrderEntry = Readonly<{ key: string; start: number; end: number }>;

function collectDirectChildOrderEntries(items: ReadonlyArray<SessionListIndexItem>, groupKey: string): ChildOrderEntry[] {
    const entries: ChildOrderEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (item.type === 'session') {
            if (item.groupKey !== groupKey) continue;
            const key = buildListItemOrderKey(item);
            if (key) entries.push({ key, start: index, end: index + 1 });
            continue;
        }

        if (item.headerKind !== 'folder') continue;
        if (resolveFolderParentGroupKeyFromVisibleItems({ items, itemIndex: index, folder: item }) !== groupKey) continue;
        const key = buildListItemOrderKey(item);
        if (!key) continue;
        const end = findFolderBlockEnd(items, index, readFolderDepth(item));
        entries.push({ key, start: index, end });
        index = end - 1;
    }
    return entries;
}

function collectDirectFolderOrderEntries(items: ReadonlyArray<SessionListIndexItem>, groupKey: string): ChildOrderEntry[] {
    const entries: ChildOrderEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (item.type !== 'header' || item.headerKind !== 'folder') continue;
        if (resolveFolderParentGroupKeyFromVisibleItems({ items, itemIndex: index, folder: item }) !== groupKey) continue;
        const key = buildListItemOrderKey(item);
        if (!key) continue;
        const end = findFolderBlockEnd(items, index, readFolderDepth(item));
        entries.push({ key, start: index, end });
        index = end - 1;
    }
    return entries;
}

export function reorderSessionListEntriesByKeys<T extends { key: string }>(entries: ReadonlyArray<T>, keys: ReadonlyArray<string>): T[] {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const used = new Set<T>();
    const out: T[] = [];
    for (const key of keys) {
        const normalized = typeof key === 'string' ? key.trim() : '';
        if (!normalized) continue;
        const found = byKey.get(normalized);
        if (found && !used.has(found)) {
            out.push(found);
            used.add(found);
        }
    }
    const unordered = entries.filter((entry) => !used.has(entry));
    return [...unordered, ...out];
}

function splitChildOrderEntriesIntoContiguousRuns(entries: ReadonlyArray<ChildOrderEntry>): ChildOrderEntry[][] {
    const runs: ChildOrderEntry[][] = [];
    let current: ChildOrderEntry[] = [];
    for (const entry of entries) {
        const previous = current[current.length - 1] ?? null;
        if (!previous || previous.end === entry.start) {
            current.push(entry);
            continue;
        }
        if (current.length > 0) runs.push(current);
        current = [entry];
    }
    if (current.length > 0) runs.push(current);
    return runs;
}

function applyChildOrderEntriesByRuns(
    source: ReadonlyArray<SessionListIndexItem>,
    entries: ReadonlyArray<ChildOrderEntry>,
    keys: ReadonlyArray<string>,
): SessionListIndexItem[] {
    let out = source as SessionListIndexItem[];
    let didChange = false;
    for (const run of splitChildOrderEntriesIntoContiguousRuns(entries)) {
        if (run.length < 2) continue;
        const reordered = reorderSessionListEntriesByKeys(run, keys);
        if (reordered.every((entry, index) => entry === run[index])) continue;

        const firstEntry = run[0]!;
        const lastEntry = run[run.length - 1]!;
        out = [
            ...out.slice(0, firstEntry.start),
            ...reordered.flatMap((entry) => out.slice(entry.start, entry.end)),
            ...out.slice(lastEntry.end),
        ];
        didChange = true;
    }
    return didChange ? out : (source as SessionListIndexItem[]);
}

function applyFoldersFirstStructuralOrderingForGroup(
    source: ReadonlyArray<SessionListIndexItem>,
    groupKey: string,
    keys: ReadonlyArray<string>,
): SessionListIndexItem[] {
    if (!keys.some((key) => typeof key === 'string' && key.startsWith('folder:'))) {
        return source as SessionListIndexItem[];
    }
    const entries = collectDirectFolderOrderEntries(source, groupKey);
    if (entries.length < 2) {
        return source as SessionListIndexItem[];
    }
    return applyChildOrderEntriesByRuns(source, entries, keys);
}

function applyFoldersFirstStructuralOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): SessionListIndexItem[] {
    let out = source as SessionListIndexItem[];
    for (const [groupKeyRaw, keys] of Object.entries(orderByGroupKey)) {
        const groupKey = String(groupKeyRaw ?? '').trim();
        if (!groupKey || !keys || keys.length === 0) continue;
        out = applyFoldersFirstStructuralOrderingForGroup(out, groupKey, keys);
    }
    return out;
}

function applyMixedChildOrderingForGroup(
    source: ReadonlyArray<SessionListIndexItem>,
    groupKey: string,
    keys: ReadonlyArray<string>,
): SessionListIndexItem[] {
    if (!keys.some((key) => typeof key === 'string' && key.startsWith('folder:'))) {
        return source as SessionListIndexItem[];
    }
    const entries = collectDirectChildOrderEntries(source, groupKey);
    if (entries.length < 2) {
        return source as SessionListIndexItem[];
    }
    return applyChildOrderEntriesByRuns(source, entries, keys);
}

function applyMixedChildOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): SessionListIndexItem[] {
    let out = source as SessionListIndexItem[];
    for (const [groupKeyRaw, keys] of Object.entries(orderByGroupKey)) {
        const groupKey = String(groupKeyRaw ?? '').trim();
        if (!groupKey || !keys || keys.length === 0) continue;
        out = applyMixedChildOrderingForGroup(out, groupKey, keys);
    }
    return out;
}

function applySessionOnlyGroupOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
    options: SessionOrderingContextOptions = {},
): SessionListIndexItem[] {
    const sessionsByScope = new Map<string, {
        groupKey: string;
        items: Array<Extract<SessionListIndexItem, { type: 'session' }>>;
    }>();

    for (const item of source) {
        if (item.type !== 'session') continue;
        const context = resolveCustomSessionOrderingContext(item, options);
        if (!context) continue;
        const bucket = sessionsByScope.get(context.scopeKey) ?? { groupKey: context.groupKey, items: [] };
        bucket.items.push(item);
        sessionsByScope.set(context.scopeKey, bucket);
    }

    const reorderedByScope = new Map<string, Array<Extract<SessionListIndexItem, { type: 'session' }>>>();
    for (const [scopeKey, bucket] of sessionsByScope.entries()) {
        const keys = orderByGroupKey[bucket.groupKey];
        if (!keys || keys.length === 0) continue;
        reorderedByScope.set(scopeKey, reorderSessionListIndexSessionItemsByKeys(bucket.items, keys));
    }

    if (reorderedByScope.size === 0) {
        return source as SessionListIndexItem[];
    }

    const indicesByScope = new Map<string, number>();
    const out: SessionListIndexItem[] = [];
    let didChange = false;
    for (const item of source) {
        if (item.type !== 'session') {
            out.push(item);
            continue;
        }
        const scopeKey = resolveSessionOrderingScopeKey(item, 'custom', options);
        if (!scopeKey) {
            out.push(item);
            continue;
        }
        const replacementList = reorderedByScope.get(scopeKey);
        if (!replacementList) {
            out.push(item);
            continue;
        }
        const index = indicesByScope.get(scopeKey) ?? 0;
        const replacement = replacementList[index] ?? item;
        if (replacement !== item) didChange = true;
        out.push(replacement);
        indicesByScope.set(scopeKey, index + 1);
    }

    return didChange ? out : (source as SessionListIndexItem[]);
}

export function applySessionListStructuralGroupOrder(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
    options: Readonly<{ folderSortMode?: SessionListFolderSortModeV1 }> = {},
): SessionListIndexItem[] {
    return normalizeSessionListFolderSortModeV1(options.folderSortMode) === 'mixed'
        ? applyMixedChildOrdering(source, orderByGroupKey)
        : applyFoldersFirstStructuralOrdering(source, orderByGroupKey);
}

export function applySessionListSessionSiblingOrder(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
    options: SessionOrderingContextOptions = {},
): SessionListIndexItem[] {
    return applySessionOnlyGroupOrdering(source, orderByGroupKey, options);
}

export function applySessionListIndexGroupOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
    options: Readonly<{ folderSortMode?: SessionListFolderSortModeV1; sectionMode?: SessionListOrderingSectionMode }> = {},
): SessionListIndexItem[] {
    const sessionOrdered = applySessionListSessionSiblingOrder(source, orderByGroupKey, options);
    return applySessionListStructuralGroupOrder(sessionOrdered, orderByGroupKey, options);
}
