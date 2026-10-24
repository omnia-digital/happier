import { describe, expect, it } from 'vitest';

import {
    assignLegacyFavoriteToTarget,
    favoritePathsForTarget,
    machinePathTargetKey,
    recordRecentPathForTarget,
    recentPathsForTarget,
    recentMachinePathsForScope,
    toggleFavoriteForTarget,
    unassignedLegacyFavoritesForTarget,
} from './machinePathPreferences';

const mac = { serverId: 'home-a', accountId: 'josh', machineId: 'mac' };
const otherHome = { serverId: 'home-b', accountId: 'josh', machineId: 'mac' };
const otherAccount = { serverId: 'home-a', accountId: 'other', machineId: 'mac' };
const windows = { serverId: 'home-a', accountId: 'josh', machineId: 'win' };

describe('machine path preferences', () => {
    it('keeps identical paths separate by exact Home, account, and machine', () => {
        const preferences = toggleFavoriteForTarget({}, mac, '~/repo', '/Users/josh');
        expect(favoritePathsForTarget(preferences, mac)).toEqual(['~/repo']);
        expect(favoritePathsForTarget(preferences, otherHome)).toEqual([]);
        expect(favoritePathsForTarget(preferences, otherAccount)).toEqual([]);
        expect(favoritePathsForTarget(preferences, windows)).toEqual([]);
        expect(new Set([mac, otherHome, otherAccount, windows].map(machinePathTargetKey)).size).toBe(4);
    });

    it('leaves legacy favorites unassigned until an explicit assignment', () => {
        const legacy = ['~/repo', 'C:\\Users\\cassian\\repo'];
        expect(favoritePathsForTarget({}, mac)).toEqual([]);
        const assigned = assignLegacyFavoriteToTarget({}, legacy, mac, '~/repo', '/Users/josh');
        expect(assigned.legacyFavorites).toEqual(legacy);
        expect(favoritePathsForTarget(assigned.preferences, mac)).toEqual(['~/repo']);
        expect(favoritePathsForTarget(assigned.preferences, windows)).toEqual([]);
        expect(unassignedLegacyFavoritesForTarget(legacy, assigned.preferences, mac, '/Users/josh')).toEqual(['C:\\Users\\cassian\\repo']);
        expect(unassignedLegacyFavoritesForTarget(legacy, assigned.preferences, windows, 'C:\\Users\\cassian')).toEqual(legacy);
    });

    it('keeps new recent paths isolated and does not consume provenance-free history', () => {
        const preferences = recordRecentPathForTarget({}, mac, '/Users/josh/repo');
        expect(recentPathsForTarget(preferences, mac)).toEqual(['/Users/josh/repo']);
        expect(recentPathsForTarget(preferences, otherHome)).toEqual([]);
        expect(recentPathsForTarget(preferences, otherAccount)).toEqual([]);
        expect(recentPathsForTarget(preferences, windows)).toEqual([]);
        expect(recentMachinePathsForScope(preferences, { serverId: 'home-a', accountId: 'josh' })).toEqual([
            { machineId: 'mac', path: '/Users/josh/repo' },
        ]);
        expect(recentMachinePathsForScope(preferences, { serverId: 'home-b', accountId: 'josh' })).toEqual([]);
    });
});
