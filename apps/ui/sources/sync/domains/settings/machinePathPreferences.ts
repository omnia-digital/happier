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
        legacyFavorites: legacyFavorites.filter((entry) => entry !== path),
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
