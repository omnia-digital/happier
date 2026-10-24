import {
    machineFilesystemListDirectory,
    machineFilesystemListRoots,
} from '@/sync/ops/machineFileBrowser';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { machinePathTargetKey, type MachinePathTarget } from '@/sync/domains/settings/machinePathPreferences';

import { sortDirectoryEntries } from './sortDirectoryEntries';
import { warmInFlight } from './warmInFlight';

export type MachineFileBrowserRoot = Readonly<{
    id: string;
    label: string;
    path: string;
}>;

export type MachineFileBrowserEntry = Readonly<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    sizeBytes?: number;
    modifiedMs?: number;
}>;

type ListMachineFileBrowserRootsResult =
    | { ok: true; roots: MachineFileBrowserRoot[] }
    | { ok: false; error: string };

type ListMachineFileBrowserDirectoryEntriesResult =
    | { ok: true; entries: MachineFileBrowserEntry[]; truncated: boolean }
    | { ok: false; error: string };

type CachedDirectoryEntries = Readonly<{
    entries: MachineFileBrowserEntry[];
    truncated: boolean;
}>;

const rootsCache = new Map<string, MachineFileBrowserRoot[]>();
const directoryEntriesCache = new Map<string, CachedDirectoryEntries>();
const rootsWarmInFlight = new Map<string, Promise<ListMachineFileBrowserRootsResult>>();
const directoryWarmInFlight = new Map<string, Promise<ListMachineFileBrowserDirectoryEntriesResult>>();

export type MachineFileBrowserIdentity = Readonly<{
    target: MachinePathTarget;
    viewerScope: ServerAccountScope;
}>;

type CacheScope = Readonly<{
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}>;

function isBrowserIdentityCurrent(machineId: string, input: CacheScope): boolean {
    const identity = input.browserIdentity;
    if (!identity) return true;
    const active = getActiveServerAccountScope();
    const requestedServerId = input.serverId || active?.serverId;
    return identity.target.machineId === machineId
        && !!requestedServerId
        && areServerProfileIdentifiersEquivalent(identity.target.serverId, requestedServerId)
        && areServerAccountScopesEqual(identity.viewerScope, active);
}

function resolveCacheScopeKey(machineId: string, input: CacheScope): string | null {
    if (input.browserIdentity) {
        return isBrowserIdentityCurrent(machineId, input)
            ? machinePathTargetKey(input.browserIdentity.target)
            : null;
    }
    if (typeof input.targetScopeKey === 'string' && input.targetScopeKey.length > 0) return input.targetScopeKey;
    const active = getActiveServerAccountScope();
    if (!active || (input.serverId && !areServerProfileIdentifiersEquivalent(input.serverId, active.serverId))) return null;
    return JSON.stringify([active.serverId, active.accountId]);
}

function getRootsCacheKey(machineId: string, input: CacheScope): string | null {
    const scope = resolveCacheScopeKey(machineId, input);
    return scope ? `${scope}\u0000${input.serverId ?? ''}\u0000${machineId}` : null;
}

function getDirectoryCacheKey(machineId: string, directoryPath: string, includeFiles: boolean, input: CacheScope): string | null {
    const rootKey = getRootsCacheKey(machineId, input);
    return rootKey ? `${rootKey}\u0000${includeFiles ? 'all' : 'dirs'}\u0000${directoryPath}` : null;
}

function readMachineIdFromRootsCacheKey(key: string): string {
    return key.split('\u0000')[2] ?? '';
}

function readMachineIdFromDirectoryCacheKey(key: string): string {
    return readMachineIdFromRootsCacheKey(key);
}

export function getCachedMachineFileBrowserRoots(input: { machineId: string; serverId?: string | null; targetScopeKey?: string | null; browserIdentity?: MachineFileBrowserIdentity | null }): MachineFileBrowserRoot[] | null {
    const key = getRootsCacheKey(input.machineId, input);
    const cached = key ? rootsCache.get(key) : null;
    return cached ? cached.slice() : null;
}

export function clearCachedMachineFileBrowserRoots(input: { machineId: string; serverId?: string | null; targetScopeKey?: string | null; browserIdentity?: MachineFileBrowserIdentity | null }): void {
    if (typeof input.serverId === 'string' || input.serverId === null) {
        const key = getRootsCacheKey(input.machineId, input);
        if (key) {
            rootsCache.delete(key);
            rootsWarmInFlight.delete(key);
            return;
        }
    }
    for (const key of rootsCache.keys()) {
        if (readMachineIdFromRootsCacheKey(key) === input.machineId) {
            rootsCache.delete(key);
        }
    }
    for (const key of rootsWarmInFlight.keys()) {
        if (readMachineIdFromRootsCacheKey(key) === input.machineId) {
            rootsWarmInFlight.delete(key);
        }
    }
}

export function getCachedMachineFileBrowserEntries(input: {
    machineId: string;
    directoryPath: string;
    includeFiles?: boolean;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): MachineFileBrowserEntry[] | null {
    const key = getDirectoryCacheKey(input.machineId, input.directoryPath, input.includeFiles !== false, input);
    const cached = key ? directoryEntriesCache.get(key) : null;
    return cached ? cached.entries.slice() : null;
}

export function getCachedMachineFileBrowserDirectoryMetadata(input: {
    machineId: string;
    directoryPath: string;
    includeFiles?: boolean;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): Readonly<{ truncated: boolean }> | null {
    const key = getDirectoryCacheKey(input.machineId, input.directoryPath, input.includeFiles !== false, input);
    const cached = key ? directoryEntriesCache.get(key) : null;
    return cached ? { truncated: cached.truncated } : null;
}

export function clearCachedMachineFileBrowserEntries(input: {
    machineId: string;
    directoryPath?: string | null;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): void {
    const rootKey = getRootsCacheKey(input.machineId, input);
    const serverPrefix = rootKey ? `${rootKey}\u0000` : null;
    const directoryPath = typeof input.directoryPath === 'string' ? input.directoryPath : null;
    if (directoryPath != null) {
        for (const key of [...directoryEntriesCache.keys()]) {
            const matchesScope = serverPrefix ? key.startsWith(serverPrefix) : readMachineIdFromDirectoryCacheKey(key) === input.machineId;
            if (matchesScope && key.endsWith(`:${directoryPath}`)) {
                directoryEntriesCache.delete(key);
                directoryWarmInFlight.delete(key);
            }
        }
        return;
    }

    for (const key of directoryEntriesCache.keys()) {
        const matchesScope = serverPrefix ? key.startsWith(serverPrefix) : readMachineIdFromDirectoryCacheKey(key) === input.machineId;
        if (matchesScope) {
            directoryEntriesCache.delete(key);
        }
    }
    for (const key of directoryWarmInFlight.keys()) {
        const matchesScope = serverPrefix ? key.startsWith(serverPrefix) : readMachineIdFromDirectoryCacheKey(key) === input.machineId;
        if (matchesScope) {
            directoryWarmInFlight.delete(key);
        }
    }
}

function setCachedMachineFileBrowserRoots(input: {
    machineId: string;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
    roots: MachineFileBrowserRoot[];
}): void {
    const key = getRootsCacheKey(input.machineId, input);
    if (key) rootsCache.set(key, input.roots.slice());
}

function setCachedMachineFileBrowserEntries(input: {
    machineId: string;
    directoryPath: string;
    includeFiles: boolean;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
    entries: MachineFileBrowserEntry[];
    truncated: boolean;
}): void {
    const key = getDirectoryCacheKey(input.machineId, input.directoryPath, input.includeFiles, input);
    if (!key) return;
    directoryEntriesCache.set(
        key,
        {
            entries: input.entries.slice(),
            truncated: input.truncated,
        },
    );
}

export async function listMachineFileBrowserRoots(input: {
    machineId: string;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): Promise<ListMachineFileBrowserRootsResult> {
    if (!isBrowserIdentityCurrent(input.machineId, input)) return { ok: false, error: 'account_scope_changed' };
    const response = await machineFilesystemListRoots(input.machineId, {
        serverId: input.serverId,
        accountId: input.browserIdentity?.target.accountId,
    });
    if (!isBrowserIdentityCurrent(input.machineId, input)) return { ok: false, error: 'account_scope_changed' };
    if (!response.ok) {
        const error = typeof response.error === 'string' ? response.error.trim() : '';
        return { ok: false, error: error || 'unknown_error' };
    }

    const roots = response.roots
        .filter((root): root is MachineFileBrowserRoot => {
            return !!root
                && typeof root.id === 'string'
                && typeof root.label === 'string'
                && typeof root.path === 'string'
                && root.id.trim().length > 0
                && root.label.trim().length > 0
                && root.path.trim().length > 0;
        })
        .map((root) => ({
            id: root.id.trim(),
            label: root.label.trim(),
            path: root.path.trim(),
        }));

    setCachedMachineFileBrowserRoots({ ...input, roots });
    return { ok: true, roots };
}

export async function warmMachineFileBrowserRoots(input: {
    machineId: string;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): Promise<ListMachineFileBrowserRootsResult> {
    const cached = getCachedMachineFileBrowserRoots(input);
    if (cached) return { ok: true, roots: cached };

    const key = getRootsCacheKey(input.machineId, input);
    if (!key) return await listMachineFileBrowserRoots(input);
    return await warmInFlight(rootsWarmInFlight, key, async () => await listMachineFileBrowserRoots(input));
}

export async function listMachineFileBrowserDirectoryEntries(input: {
        machineId: string;
        directoryPath: string;
        includeFiles: boolean;
        serverId?: string | null;
        targetScopeKey?: string | null;
        browserIdentity?: MachineFileBrowserIdentity | null;
}): Promise<ListMachineFileBrowserDirectoryEntriesResult> {
    if (!isBrowserIdentityCurrent(input.machineId, input)) return { ok: false, error: 'account_scope_changed' };
    const response = await machineFilesystemListDirectory(input.machineId, {
        path: input.directoryPath,
        includeFiles: input.includeFiles,
    }, {
        serverId: input.serverId,
        accountId: input.browserIdentity?.target.accountId,
    });
    if (!isBrowserIdentityCurrent(input.machineId, input)) return { ok: false, error: 'account_scope_changed' };

    if (!response.ok) {
        const error = typeof response.error === 'string' ? response.error.trim() : '';
        return { ok: false, error: error || 'unknown_error' };
    }

    const entries = sortDirectoryEntries(response.entries.flatMap((entry) => {
        if (!entry || typeof entry.name !== 'string' || typeof entry.path !== 'string') return [];
        const rawName = entry.name.trim();
        const rawPath = entry.path.trim();
        if (!rawName || !rawPath) return [];
        if (entry.type !== 'file' && entry.type !== 'directory') return [];
        return [{
            name: rawName,
            path: rawPath,
            type: entry.type,
            sizeBytes: typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0 ? Math.floor(entry.size) : undefined,
            modifiedMs: typeof entry.modified === 'number' && Number.isFinite(entry.modified) && entry.modified >= 0 ? Math.floor(entry.modified) : undefined,
        } satisfies MachineFileBrowserEntry];
    }));

    setCachedMachineFileBrowserEntries({
        ...input,
        entries,
        truncated: response.truncated === true,
    });
    return { ok: true, entries, truncated: response.truncated === true };
}

export async function warmMachineFileBrowserDirectoryCache(input: {
    machineId: string;
    directoryPath: string;
    includeFiles: boolean;
    serverId?: string | null;
    targetScopeKey?: string | null;
    browserIdentity?: MachineFileBrowserIdentity | null;
}): Promise<ListMachineFileBrowserDirectoryEntriesResult> {
    const cachedEntries = getCachedMachineFileBrowserEntries(input);
    const cachedMetadata = getCachedMachineFileBrowserDirectoryMetadata(input);
    if (cachedEntries) {
        return { ok: true, entries: cachedEntries, truncated: cachedMetadata?.truncated === true };
    }

    const key = getDirectoryCacheKey(input.machineId, input.directoryPath, input.includeFiles, input);
    if (!key) return await listMachineFileBrowserDirectoryEntries(input);
    return await warmInFlight(directoryWarmInFlight, key, async () => await listMachineFileBrowserDirectoryEntries(input));
}
