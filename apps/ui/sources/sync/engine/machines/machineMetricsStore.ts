import { MACHINE_METRICS_REFRESH_MS, type MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

/** `shell`: read through the released machine shell RPC because the host CLI lacks the metrics capability. */
export type MachineMetricsSource = 'capability' | 'shell';
export type MachineMetricsLoadResult = Readonly<{ status: 'ready'; source: MachineMetricsSource; snapshot: MachineMetricsSnapshot }> | Readonly<{ status: 'unsupported' | 'error' }>;
export type MachineMetricsEntry = Readonly<{
    status: 'idle' | 'loading' | 'ready' | 'offline' | 'unsupported' | 'error';
    snapshot: MachineMetricsSnapshot | null;
    receivedAt: number | null;
    source: MachineMetricsSource | null;
    refreshing: boolean;
}>;
const EMPTY: MachineMetricsEntry = Object.freeze({ status: 'idle', snapshot: null, receivedAt: null, source: null, refreshing: false });
export type MachineMetricsTarget = Readonly<{ machineId: string; online: boolean; platform?: string | null }>;
/** The last good reading per Home/account/machine key, kept across app restarts. */
export type MachineMetricsReading = Readonly<{ snapshot: MachineMetricsSnapshot; receivedAt: number; source: MachineMetricsSource }>;
export type MachineMetricsPersistence = Readonly<{
    read: (key: string) => MachineMetricsReading | null;
    write: (key: string, reading: MachineMetricsReading) => void;
}>;

export function createMachineMetricsStore(deps: Readonly<{
    load: (scope: ServerAccountScope, machineId: string, platform?: string | null) => Promise<MachineMetricsLoadResult>;
    startInterval: (tick: () => void, ms: number) => () => void;
    isActive: () => boolean;
    subscribeActiveChange?: (listener: () => void) => () => void;
    persistence?: MachineMetricsPersistence;
}>) {
    const entries = new Map<string, MachineMetricsEntry>();
    const listeners = new Map<string, Set<() => void>>();
    // The platform selects the read path, so it is part of what an in-flight read may be shared for.
    const pending = new Map<string, { operation: Promise<void>; platform: string | null | undefined }>();
    const online = new Map<string, boolean>();
    const platforms = new Map<string, string | null | undefined>();
    const pollers = new Map<string, { callbacks: Set<(onlyIfDue: boolean) => void>; stop: () => void }>();
    const keyFor = (scope: ServerAccountScope, machineId: string) => JSON.stringify([scope.serverId, scope.accountId, machineId]);
    const entryFor = (key: string): MachineMetricsEntry => {
        const current = entries.get(key);
        if (current) return current;
        const saved = deps.persistence?.read(key) ?? null;
        if (!saved) return EMPTY;
        // Seed once so later reads return the same reference to subscribers.
        const seeded: MachineMetricsEntry = { status: 'idle', snapshot: saved.snapshot, receivedAt: saved.receivedAt, source: saved.source, refreshing: false };
        entries.set(key, seeded);
        return seeded;
    };
    const get = (scope: ServerAccountScope, machineId: string) => entryFor(keyFor(scope, machineId));
    const publish = (key: string, value: MachineMetricsEntry) => {
        const previous = entryFor(key);
        if (previous.status === value.status && previous.snapshot === value.snapshot && previous.receivedAt === value.receivedAt
            && previous.source === value.source && previous.refreshing === value.refreshing) return;
        entries.set(key, value);
        listeners.get(key)?.forEach((listener) => listener());
    };
    const refresh = (scope: ServerAccountScope, machineId: string, isOnline: boolean): Promise<void> => {
        const key = keyFor(scope, machineId);
        online.set(key, isOnline);
        const previous = get(scope, machineId);
        if (!isOnline) {
            publish(key, { ...previous, status: 'offline', refreshing: false });
            return Promise.resolve();
        }
        if (!deps.isActive()) return Promise.resolve();
        const platform = platforms.get(key);
        const inFlight = pending.get(key);
        if (inFlight) {
            // Only a released-CLI host's shell read depends on the platform; re-read when it missed it.
            return inFlight.platform === platform ? inFlight.operation
                : inFlight.operation.then(() => (get(scope, machineId).status === 'unsupported' ? refresh(scope, machineId, online.get(key) !== false) : undefined));
        }
        publish(key, { ...previous, status: previous.snapshot ? previous.status : 'loading', refreshing: true });
        const operation = deps.load(scope, machineId, platform).catch((): MachineMetricsLoadResult => ({ status: 'error' })).then((result) => {
            const current = get(scope, machineId);
            const isStillOnline = online.get(key) !== false;
            if (result.status === 'ready') {
                const reading = { snapshot: result.snapshot, receivedAt: Date.now(), source: result.source };
                deps.persistence?.write(key, reading);
                publish(key, { status: isStillOnline ? 'ready' : 'offline', ...reading, refreshing: false });
            } else {
                publish(key, { ...current, status: isStillOnline ? result.status : 'offline', refreshing: false });
            }
        }).finally(() => { if (pending.get(key)?.operation === operation) pending.delete(key); });
        pending.set(key, { operation, platform });
        return operation;
    };
    return {
        get,
        subscribe: (scope: ServerAccountScope, machineId: string, listener: () => void) => {
            const key = keyFor(scope, machineId);
            let set = listeners.get(key);
            if (!set) { set = new Set(); listeners.set(key, set); }
            set.add(listener);
            return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
        },
        refresh,
        retain: (scope: ServerAccountScope, targets: readonly MachineMetricsTarget[]) => {
            let currentTargets = targets;
            const scopeKey = JSON.stringify([scope.serverId, scope.accountId]);
            const tick = (onlyIfDue: boolean) => {
                for (const target of currentTargets) {
                    platforms.set(keyFor(scope, target.machineId), target.platform);
                    const current = get(scope, target.machineId);
                    if (!onlyIfDue || !target.online || current.status !== 'ready' || current.receivedAt === null || Date.now() - current.receivedAt >= MACHINE_METRICS_REFRESH_MS) {
                        void refresh(scope, target.machineId, target.online);
                    }
                }
            };
            tick(true);
            let poller = pollers.get(scopeKey);
            if (!poller) {
                const callbacks = new Set<(onlyIfDue: boolean) => void>();
                const stopInterval = deps.startInterval(() => callbacks.forEach((callback) => callback(false)), MACHINE_METRICS_REFRESH_MS);
                const stopResume = deps.subscribeActiveChange?.(() => { if (deps.isActive()) callbacks.forEach((callback) => callback(true)); });
                poller = { callbacks, stop: () => { stopInterval(); stopResume?.(); } };
                pollers.set(scopeKey, poller);
            }
            poller.callbacks.add(tick);
            return {
                updateTargets: (next: readonly MachineMetricsTarget[]) => { currentTargets = next; tick(true); },
                release: () => {
                    poller.callbacks.delete(tick);
                    if (!poller.callbacks.size) { poller.stop(); pollers.delete(scopeKey); }
                },
            };
        },
    };
}
