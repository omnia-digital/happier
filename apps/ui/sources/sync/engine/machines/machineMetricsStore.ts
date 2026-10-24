import { MACHINE_METRICS_REFRESH_MS, type MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export type MachineMetricsLoadResult = Readonly<{ status: 'ready'; snapshot: MachineMetricsSnapshot }> | Readonly<{ status: 'unsupported' | 'error' }>;
export type MachineMetricsEntry = Readonly<{
    status: 'idle' | 'loading' | 'ready' | 'offline' | 'unsupported' | 'error';
    snapshot: MachineMetricsSnapshot | null;
    receivedAt: number | null;
    refreshing: boolean;
}>;
const EMPTY: MachineMetricsEntry = Object.freeze({ status: 'idle', snapshot: null, receivedAt: null, refreshing: false });
export type MachineMetricsTarget = Readonly<{ machineId: string; online: boolean }>;

export function createMachineMetricsStore(deps: Readonly<{
    load: (scope: ServerAccountScope, machineId: string) => Promise<MachineMetricsLoadResult>;
    startInterval: (tick: () => void, ms: number) => () => void;
    isActive: () => boolean;
    subscribeActiveChange?: (listener: () => void) => () => void;
}>) {
    const entries = new Map<string, MachineMetricsEntry>();
    const listeners = new Map<string, Set<() => void>>();
    const pending = new Map<string, Promise<void>>();
    const online = new Map<string, boolean>();
    const pollers = new Map<string, { callbacks: Set<(onlyIfDue: boolean) => void>; stop: () => void }>();
    const keyFor = (scope: ServerAccountScope, machineId: string) => JSON.stringify([scope.serverId, scope.accountId, machineId]);
    const get = (scope: ServerAccountScope, machineId: string) => entries.get(keyFor(scope, machineId)) ?? EMPTY;
    const publish = (key: string, value: MachineMetricsEntry) => {
        const previous = entries.get(key) ?? EMPTY;
        if (previous.status === value.status && previous.snapshot === value.snapshot && previous.receivedAt === value.receivedAt && previous.refreshing === value.refreshing) return;
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
        const inFlight = pending.get(key);
        if (inFlight) return inFlight;
        publish(key, { ...previous, status: previous.snapshot ? previous.status : 'loading', refreshing: true });
        const operation = deps.load(scope, machineId).catch((): MachineMetricsLoadResult => ({ status: 'error' })).then((result) => {
            const current = get(scope, machineId);
            const isStillOnline = online.get(key) !== false;
            publish(key, result.status === 'ready'
                ? { status: isStillOnline ? 'ready' : 'offline', snapshot: result.snapshot, receivedAt: Date.now(), refreshing: false }
                : { ...current, status: isStillOnline ? result.status : 'offline', refreshing: false });
        }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
        pending.set(key, operation);
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
