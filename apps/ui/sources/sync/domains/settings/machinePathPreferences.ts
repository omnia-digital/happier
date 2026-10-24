import { normalizeFileSystemPath } from '@/sync/domains/fileSystem/normalizeFileSystemPath';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export type MachinePathTarget = Readonly<{ serverId: string; accountId: string; machineId: string }>;
export type MachinePathPreferencesByTargetV1 = Record<string, Readonly<{ favorites: string[]; recentPaths: string[] }>>;

export function machinePathTargetKey(target: MachinePathTarget): string {
    return JSON.stringify([target.serverId, target.accountId, target.machineId]);
}

export function resolveDirectoryFavoriteComparisonKey(path: string, homeDir: string | null | undefined): string {
    const safeHomeDir = typeof homeDir === 'string' && homeDir.length > 0 ? homeDir : undefined;
    const resolvedPath = resolveAbsolutePath(path, safeHomeDir);
    return normalizeFileSystemPath(resolvedPath) ?? resolvedPath;
}

export function normalizeDirectoryFavoritePaths(storedFavorites: ReadonlyArray<unknown> | null | undefined, homeDir: string | null | undefined): ReadonlyArray<string> {
    const sanitized = Array.isArray(storedFavorites)
        ? storedFavorites.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const seenKeys = new Set<string>();
    const normalized: string[] = [];
    for (const stored of sanitized) {
        const key = resolveDirectoryFavoriteComparisonKey(stored, homeDir);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        normalized.push(stored);
    }
    return normalized;
}

export function toggleHomeAwareDirectoryFavorite(storedFavorites: ReadonlyArray<unknown> | null | undefined, target: string, homeDir: string | null | undefined): ReadonlyArray<string> {
    const targetKey = resolveDirectoryFavoriteComparisonKey(target, homeDir);
    const sanitized = normalizeDirectoryFavoritePaths(storedFavorites, homeDir);
    const isFavorite = sanitized.some((stored) => resolveDirectoryFavoriteComparisonKey(stored, homeDir) === targetKey);
    return isFavorite
        ? sanitized.filter((stored) => resolveDirectoryFavoriteComparisonKey(stored, homeDir) !== targetKey)
        : [...sanitized, target];
}

export function favoritePathsForTarget(preferences: MachinePathPreferencesByTargetV1, target: MachinePathTarget | null): ReadonlyArray<string> {
    return target ? preferences[machinePathTargetKey(target)]?.favorites ?? [] : [];
}

export function recentPathsForTarget(preferences: MachinePathPreferencesByTargetV1, target: MachinePathTarget | null): ReadonlyArray<string> {
    return target ? preferences[machinePathTargetKey(target)]?.recentPaths ?? [] : [];
}

export function recentMachinePathsForScope(
    preferences: MachinePathPreferencesByTargetV1,
    scope: Readonly<{ serverId: string; accountId: string }> | null,
): ReadonlyArray<Readonly<{ machineId: string; path: string }>> {
    if (!scope) return [];
    const entries: Array<{ machineId: string; path: string }> = [];
    for (const [key, value] of Object.entries(preferences)) {
        let parts: unknown;
        try { parts = JSON.parse(key); } catch { continue; }
        if (!Array.isArray(parts) || parts.length !== 3
            || parts[0] !== scope.serverId || parts[1] !== scope.accountId
            || typeof parts[2] !== 'string') continue;
        for (const path of value.recentPaths) entries.push({ machineId: parts[2], path });
    }
    return entries;
}

export function unassignedLegacyFavoritesForTarget(
    legacyFavorites: ReadonlyArray<string>,
    preferences: MachinePathPreferencesByTargetV1,
    target: MachinePathTarget | null,
    homeDir: string | null | undefined,
): ReadonlyArray<string> {
    if (!target) return [];
    const assigned = new Set(favoritePathsForTarget(preferences, target).map((path) => resolveDirectoryFavoriteComparisonKey(path, homeDir)));
    return legacyFavorites.filter((path) => !assigned.has(resolveDirectoryFavoriteComparisonKey(path, homeDir)));
}

export function toggleFavoriteForTarget(preferences: MachinePathPreferencesByTargetV1, target: MachinePathTarget, path: string, homeDir: string | null | undefined): MachinePathPreferencesByTargetV1 {
    const key = machinePathTargetKey(target);
    const existing = preferences[key];
    return {
        ...preferences,
        [key]: {
            favorites: [...toggleHomeAwareDirectoryFavorite(existing?.favorites, path, homeDir)],
            recentPaths: existing?.recentPaths ?? [],
        },
    };
}

export function replaceFavoritePathsForTarget(preferences: MachinePathPreferencesByTargetV1, target: MachinePathTarget, paths: ReadonlyArray<string>, homeDir: string | null | undefined): MachinePathPreferencesByTargetV1 {
    const key = machinePathTargetKey(target);
    return {
        ...preferences,
        [key]: {
            favorites: [...normalizeDirectoryFavoritePaths(paths, homeDir)],
            recentPaths: preferences[key]?.recentPaths ?? [],
        },
    };
}

export function assignLegacyFavoriteToTarget(preferences: MachinePathPreferencesByTargetV1, legacyFavorites: ReadonlyArray<string>, target: MachinePathTarget, path: string, homeDir: string | null | undefined): Readonly<{ preferences: MachinePathPreferencesByTargetV1; legacyFavorites: string[] }> {
    // Assignment is explicit. Never infer a host from a path or home shorthand.
    if (!legacyFavorites.includes(path)) return { preferences, legacyFavorites: [...legacyFavorites] };
    const key = machinePathTargetKey(target);
    const existing = preferences[key];
    const favorites = normalizeDirectoryFavoritePaths([...(existing?.favorites ?? []), path], homeDir);
    return {
        preferences: {
            ...preferences,
            [key]: { favorites: [...favorites], recentPaths: existing?.recentPaths ?? [] },
        },
        legacyFavorites: [...legacyFavorites],
    };
}

export function recordRecentPathForTarget(preferences: MachinePathPreferencesByTargetV1, target: MachinePathTarget, path: string): MachinePathPreferencesByTargetV1 {
    const key = machinePathTargetKey(target);
    const existing = preferences[key];
    return {
        ...preferences,
        [key]: {
            favorites: existing?.favorites ?? [],
            recentPaths: [path, ...(existing?.recentPaths ?? []).filter((entry) => entry !== path)].slice(0, 10),
        },
    };
}
