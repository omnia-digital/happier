import { buildSettingArtifacts, defineSettingDefinitions } from '@happier-dev/protocol';
import { z } from 'zod';

import { FavoriteModelSelectionV1Schema } from '@/sync/domains/models/favoriteModelSelections';
import { FavoriteBackendTargetKeysV1Schema } from '@/sync/domains/sessionAuthoring/favoriteBackendTargets';

function arrayCount(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

function buildDismissedCliWarningsSummaryProperties(value: unknown): Record<string, number> {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const globalWarnings = record.global && typeof record.global === 'object' && !Array.isArray(record.global)
        ? record.global as Record<string, unknown>
        : {};
    const perMachineWarnings = record.perMachine && typeof record.perMachine === 'object' && !Array.isArray(record.perMachine)
        ? record.perMachine as Record<string, unknown>
        : {};

    let perMachineDismissedCount = 0;
    for (const machineWarnings of Object.values(perMachineWarnings)) {
        if (!machineWarnings || typeof machineWarnings !== 'object' || Array.isArray(machineWarnings)) continue;
        perMachineDismissedCount += Object.keys(machineWarnings as Record<string, unknown>).length;
    }

    return {
        globalDismissedCount: Object.keys(globalWarnings).length,
        perMachineDismissedCount,
    };
}

export const ACCOUNT_COLLECTION_SETTING_DEFINITIONS = defineSettingDefinitions({
    recentMachinePaths: {
        schema: z.array(z.object({ machineId: z.string(), path: z.string() })),
        default: [],
        description: 'Last 10 machine-path combinations, ordered by most recent first',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    favoriteDirectories: {
        schema: z.array(z.string()),
        default: [],
        description: 'User-defined favorite directories for quick access in path selection',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    machinePathPreferencesByTargetV1: {
        schema: z.record(z.string(), z.object({
            favorites: z.array(z.string()),
            recentPaths: z.array(z.string()),
        })),
        default: {},
        description: 'Viewer path preferences assigned to an exact Home, account, and machine',
        storageScope: 'account',
    },
    favoriteMachines: {
        schema: z.array(z.string()),
        default: [],
        description: 'User-defined favorite machines (machine IDs) for quick access in machine selection',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    favoriteProfiles: {
        schema: z.array(z.string()),
        default: [],
        description: 'User-defined favorite profiles (profile IDs) for quick access in profile selection',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    favoriteModelSelectionsV1: {
        schema: z.array(FavoriteModelSelectionV1Schema),
        default: [],
        description: 'User-defined favorite engine model selections for quick access in engine selection',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    favoriteBackendTargetKeysV1: {
        schema: FavoriteBackendTargetKeysV1Schema,
        default: [],
        description: 'User-defined favorite new-session engines for quick access in engine selection',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrent: arrayCount,
        },
    },
    dismissedCLIWarnings: {
        schema: z.object({
            perMachine: z.record(z.string(), z.record(z.string(), z.boolean()).default({})).default({}),
            global: z.record(z.string(), z.boolean()).default({}),
        }).default({ perMachine: {}, global: {} }),
        default: { perMachine: {}, global: {} },
        description: 'Tracks which CLI installation warnings user has dismissed (per-machine or globally)',
        storageScope: 'account',
        analytics: {
            trackCurrentState: true,
            trackChanges: true,
            valueKind: 'count',
            privacy: 'count_only',
            identityScope: 'person',
            serializeCurrentProperties: buildDismissedCliWarningsSummaryProperties,
        },
    },
});

export const ACCOUNT_COLLECTION_SETTING_ARTIFACTS = buildSettingArtifacts(ACCOUNT_COLLECTION_SETTING_DEFINITIONS);
