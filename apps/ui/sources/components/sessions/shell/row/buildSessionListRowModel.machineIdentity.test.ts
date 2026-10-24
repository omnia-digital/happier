import { describe, expect, it } from 'vitest';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { buildSessionListRowModel } from './buildSessionListRowModel';
import { buildCachedSessionListRowModel, createSessionListRowModelsCache } from './buildSessionListRowModels';
import type { SessionListRowPresentationSettings } from './sessionListRowModelTypes';

const session = {
    id: 'session-a', seq: 1, createdAt: 1, updatedAt: 1, active: false, activeAt: 0,
    metadataVersion: 1, agentStateVersion: 1, metadata: {
        name: 'Session A', path: '/repo/project', machineId: 'machine-a', host: 'old-host',
    }, thinking: false, thinkingAt: 0, presence: 'online',
} as SessionListRenderableSession;

const settings = {
    currentUserId: 'user-a', density: 'minimal', compact: true, compactMinimal: true,
    identityDisplay: 'agentLogo', activeColorMode: 'allActive', workingIndicatorMode: 'spinner',
    workingTextMode: 'static', statusColors: {
        connected: '#000', connecting: '#000', actionRequired: '#000',
        disconnected: '#000', error: '#000', default: '#000',
    }, hideInactiveSessions: false, showServerBadge: false, showPinnedServerBadge: false,
    agentActivityCountEnabled: false, tagsEnabled: false, sessionTagsByKey: {}, allKnownTags: [],
    pinnedSessionKeys: [], attentionStandingEnabled: false,
    attentionStandingPolicy: { defaultStanding: false, overridesBySessionKey: {} },
    hasMultipleMachines: true, reachableSessionDisplayByKey: {
        'server-a:session-a': { machineLabel: 'Replacement Mac', workspaceSubtitle: 'project' },
    }, folderViewEnabled: false, relativeNowMs: 1000, runtimeNowMs: 1000,
    showMachineIdentity: true,
} as unknown as SessionListRowPresentationSettings;

function build(overrides: Partial<SessionListRowPresentationSettings> = {}) {
    return buildSessionListRowModel({
        item: {
            type: 'session', session, serverId: 'server-a', groupKey: 'pinned', groupKind: 'pinned', pinned: true,
        } as Extract<SessionListViewItem, { type: 'session' }>,
        isFirst: true, isLast: true, isSingle: true,
        settings: { ...settings, ...overrides },
    });
}

describe('session row machine identity', () => {
    it('carries the canonical resolved name into a compact Pinned row independently of its subtitle', () => {
        const row = build();
        expect(row.machineLabel).toBe('Replacement Mac');
        expect(row.showMachineIdentity).toBe(true);
        expect(row.isPinned).toBe(true);
        expect(row.subtitle).toBe('Replacement Mac · project');
    });

    it('hides the indicator on opt-out without changing the canonical machine or workspace subtitle', () => {
        const row = build({ showMachineIdentity: false });
        expect(row.machineLabel).toBe('Replacement Mac');
        expect(row.showMachineIdentity).toBe(false);
        expect(row.subtitle).toBe('Replacement Mac · project');
    });

    it('does not guess a different machine when the resolved projection is missing', () => {
        const row = build({ reachableSessionDisplayByKey: {
            'server-b:session-a': { machineLabel: 'Wrong server Mac', workspaceSubtitle: 'other' },
        } });
        expect(row.machineLabel).toBeNull();
        expect(row.sessionId).toBe('session-a');
    });

    it('keeps the identity when the list currently has only one known machine', () => {
        const row = build({ hasMultipleMachines: false });
        expect(row.machineLabel).toBe('Replacement Mac');
    });

    it('rebuilds the mounted row on local preference changes without losing the resolved name', () => {
        const item = {
            type: 'session', session, serverId: 'server-a', groupKey: 'pinned', groupKind: 'pinned', pinned: true,
        } as Extract<SessionListViewItem, { type: 'session' }>;
        const cache = createSessionListRowModelsCache();
        const base = {
            item, cache, snapshot: { session: undefined, renderable: undefined, messages: undefined, pending: undefined },
            adjacency: { isFirst: true, isLast: true, isSingle: true },
        } as const;
        const shown = buildCachedSessionListRowModel({ ...base, settings });
        const hidden = buildCachedSessionListRowModel({ ...base, settings: { ...settings, showMachineIdentity: false } });
        expect(hidden).not.toBe(shown);
        expect(hidden.machineLabel).toBe('Replacement Mac');
        expect(hidden.showMachineIdentity).toBe(false);
    });

    it('rebuilds a Pinned row when only machine label visibility changes', () => {
        const item = {
            type: 'session', session, serverId: 'server-a', groupKey: 'pinned', groupKind: 'pinned', pinned: true,
        } as Extract<SessionListViewItem, { type: 'session' }>;
        const cache = createSessionListRowModelsCache();
        const input = {
            item, cache, snapshot: { session: undefined, renderable: undefined, messages: undefined, pending: undefined },
            adjacency: { isFirst: true, isLast: true, isSingle: true },
        } as const;
        const shown = buildCachedSessionListRowModel({ ...input, settings: { ...settings, showMachineLabel: true } });
        const iconOnly = buildCachedSessionListRowModel({ ...input, settings: { ...settings, showMachineLabel: false } });
        expect(iconOnly).not.toBe(shown);
        expect(iconOnly.machineLabel).toBe('Replacement Mac');
        expect(iconOnly.showMachineIdentity).toBe(true);
        expect(iconOnly.showMachineLabel).toBe(false);
    });

    it('uses the same label choice for ordinary and machine-grouped rows', () => {
        for (const groupKind of ['date', 'machine'] as const) {
            const row = buildSessionListRowModel({
                item: {
                    type: 'session', session, serverId: 'server-a', groupKey: groupKind,
                    groupKind, pinned: false,
                } as Extract<SessionListViewItem, { type: 'session' }>,
                isFirst: true, isLast: true, isSingle: true,
                settings: { ...settings, showMachineLabel: false },
            });
            expect(row.isPinned).toBe(false);
            expect(row.machineLabel).toBe('Replacement Mac');
            expect(row.showMachineIdentity).toBe(true);
            expect(row.showMachineLabel).toBe(false);
        }
    });
});
