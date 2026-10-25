import { resolveMachineDisplayScope, type MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';
import { storage, type SessionListViewItem } from '@/sync/domains/state/storage';
import { getActiveServerId } from '@/sync/domains/server/serverProfiles';
import type { MachineCollection } from '@/sync/domains/machines/identity/machineCollection';
import { readSessionWorkspacePresentation } from '@/sync/ops/sessionMachineTarget';
import { sessionTagKey } from './sessionTagUtils';

type SessionReachableDisplay = Readonly<{
    machineId: string | null;
    machineLabel: string;
    workspaceSubtitle: string;
    workspaceSubtitleEllipsizeMode: 'head' | 'tail';
}>;

export type SessionListReachabilityModels = Readonly<{
    reachableSessionDisplayByKey: Map<string, SessionReachableDisplay>;
    hasMultipleMachines: boolean;
}>;

type SessionListReachabilityCacheEntry = Readonly<{
    display: SessionReachableDisplay;
    machineKey: string;
    machineDisplaySignature: string;
    session: Extract<SessionListViewItem, { type: 'session' }>['session'];
    workspaceLabelsV1: Readonly<Record<string, string>>;
}>;

type RetainedSessionListReachabilityModels = Readonly<{
    entriesByKey: Map<string, SessionListReachabilityCacheEntry>;
    machineDisplaySignature: string;
    models: SessionListReachabilityModels;
    previousKeys: readonly string[];
    workspaceLabelsV1: Readonly<Record<string, string>>;
}>;

export type SessionListReachabilityModelsCache = {
    entriesByKey: Map<string, SessionListReachabilityCacheEntry>;
    previousKeys: readonly string[];
    previousModels: SessionListReachabilityModels | null;
};

const EMPTY_REACHABILITY_MODELS: SessionListReachabilityModels = {
    reachableSessionDisplayByKey: new Map<string, SessionReachableDisplay>(),
    hasMultipleMachines: false,
};

// Phone navigation can remount the list while its retained item projection remains alive.
// Keying the existing reachability cache by that owned projection lets the next hook instance
// recover the same derived model without a second  O(all sessions) pass. Weak ownership keeps
// the entry bounded by the retained list itself.
const retainedReachabilityModelsByItems = new WeakMap<
    ReadonlyArray<SessionListViewItem>,
    RetainedSessionListReachabilityModels
>();

function areStringRecordsEqual(
    previous: Readonly<Record<string, string>>,
    next: Readonly<Record<string, string>>,
): boolean {
    if (previous === next) return true;
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (previousKeys.length !== nextKeys.length) return false;
    for (const key of previousKeys) {
        if (previous[key] !== next[key]) return false;
    }
    return true;
}

export function createSessionListReachabilityModelsCache(): SessionListReachabilityModelsCache {
    return {
        entriesByKey: new Map<string, SessionListReachabilityCacheEntry>(),
        previousKeys: [],
        previousModels: null,
    };
}

function resolveReachableDisplayRowKey(item: Extract<SessionListViewItem, { type: 'session' }>): string {
    const serverId = typeof item.serverId === 'string' ? item.serverId.trim() : '';
    const sessionId = String(item.session.id);
    return serverId ? sessionTagKey(serverId, sessionId) : sessionId;
}

function resolveMachineKey(display: SessionReachableDisplay): string {
    return display.machineId ?? display.machineLabel ?? '';
}

function buildReachabilityMachineDisplaySignature(machines: MachineCollection<MachineDisplayRenderable>): string {
    // Display target resolution follows replacement links; workspace presentation reads
    // names and home directories. Presence/heartbeat timestamps affect neither. Keep
    // this cache key local to display derivation, not the machine's live status projection.
    return JSON.stringify(Object.values(machines).sort((a, b) => a.id.localeCompare(b.id)).map((machine) => {
        return [machine.id, machine.replacedByMachineId ?? null,
            machine.metadata?.displayName ?? null, machine.metadata?.host ?? null,
            machine.metadata?.homeDir ?? null];
    }));
}

export function buildSessionReachableDisplay(input: Readonly<{
    item: Extract<SessionListViewItem, { type: 'session' }>;
    machinesById: Readonly<Record<string, MachineDisplayRenderable>>;
    machineListByServerId?: Readonly<Record<string, readonly MachineDisplayRenderable[] | null | undefined>>;
    workspaceLabelsV1: Readonly<Record<string, string>>;
}>): Readonly<{
    display: SessionReachableDisplay;
    machineKey: string;
    workspace: ReturnType<typeof resolveSessionWorkspacePresentation>;
}> {
    const workspace = readSessionWorkspacePresentation({
        sessionId: input.item.session.id,
        serverId: input.item.serverId,
        metadata: input.item.session?.metadata ?? null,
        machines: input.machinesById,
        machineListByServerId: input.machineListByServerId,
        workspaceLabelsV1: input.workspaceLabelsV1,
    });
    const display = {
        machineId: workspace.machineId,
        machineLabel: workspace.machineLabel,
        workspaceSubtitle: workspace.displayTitle,
        workspaceSubtitleEllipsizeMode: workspace.hasCustomLabel ? 'tail' : 'head',
    } satisfies SessionReachableDisplay;

    return {
        display,
        machineKey: input.item.serverId ? `${input.item.serverId}\u0000${resolveMachineKey(display)}` : resolveMachineKey(display),
        workspace,
    };
}

function canReuseReachabilityEntry(input: Readonly<{
    cached: SessionListReachabilityCacheEntry | undefined;
    item: Extract<SessionListViewItem, { type: 'session' }>;
    machineDisplaySignature: string;
    workspaceLabelsV1: Readonly<Record<string, string>>;
}>): input is Readonly<{
    cached: SessionListReachabilityCacheEntry;
    item: Extract<SessionListViewItem, { type: 'session' }>;
    machineDisplaySignature: string;
    workspaceLabelsV1: Readonly<Record<string, string>>;
}> {
    return input.cached != null
        && input.cached.session === input.item.session
        && input.cached.machineDisplaySignature === input.machineDisplaySignature
        && input.cached.workspaceLabelsV1 === input.workspaceLabelsV1;
}

function areReachabilityModelKeysAndDisplaysEqual(input: Readonly<{
    previousKeys: readonly string[];
    previousModels: SessionListReachabilityModels | null;
    nextKeys: readonly string[];
    nextDisplayByKey: ReadonlyMap<string, SessionReachableDisplay>;
}>): boolean {
    if (!input.previousModels) return false;
    if (input.previousKeys.length !== input.nextKeys.length) return false;
    for (let index = 0; index < input.nextKeys.length; index += 1) {
        const key = input.nextKeys[index];
        if (input.previousKeys[index] !== key) return false;
        if (input.previousModels.reachableSessionDisplayByKey.get(key) !== input.nextDisplayByKey.get(key)) {
            return false;
        }
    }
    return true;
}

export function buildSessionListReachabilityModels(input: Readonly<{
    items: ReadonlyArray<SessionListViewItem> | null | undefined;
    machinesById: Readonly<Record<string, MachineDisplayRenderable>>;
    machineListByServerId?: Readonly<Record<string, readonly MachineDisplayRenderable[] | null | undefined>>;
    workspaceLabelsV1: Readonly<Record<string, string>>;
    cache?: SessionListReachabilityModelsCache;
}>): SessionListReachabilityModels {
    const items = input.items;
    if (!items || items.length === 0) {
        if (input.cache) {
            input.cache.entriesByKey = new Map();
            input.cache.previousKeys = [];
            input.cache.previousModels = EMPTY_REACHABILITY_MODELS;
        }
        return EMPTY_REACHABILITY_MODELS;
    }

    const state = storage.getState();
    const machineListByServerId = input.machineListByServerId ?? state.machineListByServerId;
    const signaturesByServer = new Map<string, string>();
    for (const item of items) {
        if (item.type !== 'session') continue;
        const serverId = item.serverId ?? '';
        if (signaturesByServer.has(serverId)) continue;
        const scope = resolveMachineDisplayScope({
            serverId, activeServerId: state.profileScope?.serverId ?? getActiveServerId(),
            machines: input.machinesById, machineListByServerId,
        });
        signaturesByServer.set(serverId, JSON.stringify([scope.isActive, buildReachabilityMachineDisplaySignature(scope.machines)]));
    }
    const machineDisplaySignature = JSON.stringify([...signaturesByServer]);
    const retained = retainedReachabilityModelsByItems.get(items);
    if (
        input.cache
        && retained
        && retained.machineDisplaySignature === machineDisplaySignature
        && areStringRecordsEqual(retained.workspaceLabelsV1, input.workspaceLabelsV1)
    ) {
        input.cache.entriesByKey = retained.entriesByKey;
        input.cache.previousKeys = retained.previousKeys;
        input.cache.previousModels = retained.models;
        return retained.models;
    }

    const reachableSessionDisplayByKey = new Map<string, SessionReachableDisplay>();
    const machineIds = new Set<string>();
    const nextCacheEntriesByKey = input.cache ? new Map<string, SessionListReachabilityCacheEntry>() : null;
    const nextKeys: string[] = [];

    for (const item of items) {
        if (item.type !== 'session') continue;
        const key = resolveReachableDisplayRowKey(item);
        const cached = input.cache?.entriesByKey.get(key);
        const canReuse = canReuseReachabilityEntry({
            cached,
            item,
            machineDisplaySignature: signaturesByServer.get(item.serverId ?? '') ?? '',
            workspaceLabelsV1: input.workspaceLabelsV1,
        });
        const entry: SessionListReachabilityCacheEntry = canReuse && cached
            ? cached
            : (() => {
                const result = buildSessionReachableDisplay({
                    item,
                    machinesById: input.machinesById,
                    machineListByServerId,
                    workspaceLabelsV1: input.workspaceLabelsV1,
                });
                return {
                    display: result.display,
                    machineKey: result.machineKey,
                    machineDisplaySignature: signaturesByServer.get(item.serverId ?? '') ?? '',
                    session: item.session,
                    workspaceLabelsV1: input.workspaceLabelsV1,
                } satisfies SessionListReachabilityCacheEntry;
            })();

        reachableSessionDisplayByKey.set(key, entry.display);
        nextCacheEntriesByKey?.set(key, entry);
        nextKeys.push(key);
        if (entry.machineKey) machineIds.add(entry.machineKey);
    }

    if (reachableSessionDisplayByKey.size === 0) {
        if (input.cache) {
            input.cache.entriesByKey = new Map();
            input.cache.previousKeys = [];
            input.cache.previousModels = EMPTY_REACHABILITY_MODELS;
        }
        return EMPTY_REACHABILITY_MODELS;
    }

    if (input.cache) {
        if (areReachabilityModelKeysAndDisplaysEqual({
            previousKeys: input.cache.previousKeys,
            previousModels: input.cache.previousModels,
            nextKeys,
            nextDisplayByKey: reachableSessionDisplayByKey,
        })) {
            if (nextCacheEntriesByKey) input.cache.entriesByKey = nextCacheEntriesByKey;
            return input.cache.previousModels as SessionListReachabilityModels;
        }
    }

    const models = {
        reachableSessionDisplayByKey,
        hasMultipleMachines: machineIds.size > 1,
    } satisfies SessionListReachabilityModels;

    if (input.cache) {
        if (nextCacheEntriesByKey) input.cache.entriesByKey = nextCacheEntriesByKey;
        input.cache.previousKeys = nextKeys;
        input.cache.previousModels = models;
        retainedReachabilityModelsByItems.set(items, {
            entriesByKey: input.cache.entriesByKey,
            machineDisplaySignature,
            models,
            previousKeys: nextKeys,
            workspaceLabelsV1: input.workspaceLabelsV1,
        });
    }

    return models;
}
