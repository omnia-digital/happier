import * as React from 'react';
import { MACHINE_METRICS_REFRESH_MS, MachineMetricsSnapshotSchema } from '@happier-dev/protocol/capabilities';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createMachineMetricsStore, type MachineMetricsReading, type MachineMetricsTarget } from '@/sync/engine/machines/machineMetricsStore';
import { loadMachineMetrics } from '@/sync/ops/machineMetrics';
import { createPersistentProbedResourceCache } from '@/sync/runtime/probedResources/createPersistentProbedResourceCache';
import { isHostVisible, isRuntimeActive, startRuntimeActiveGatedInterval, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';

const lastReadings = createPersistentProbedResourceCache<MachineMetricsReading>({
    cacheId: 'machine-metrics-last-reading',
    persistKey: 'machine-metrics-last-reading',
    persistVersion: 1,
    // One entry per Home/account/machine row; a week keeps an occasionally used host's last reading.
    persistMaxEntries: 64,
    persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    staleTimeMs: MACHINE_METRICS_REFRESH_MS,
    errorCooldownMs: 0,
    deleteOnPersistVersionMismatch: true,
    normalizePersistedValue: (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const { snapshot, receivedAt, source } = raw as Record<string, unknown>;
        const parsed = MachineMetricsSnapshotSchema.safeParse(snapshot);
        return parsed.success && typeof receivedAt === 'number' && Number.isFinite(receivedAt) && (source === 'capability' || source === 'shell')
            ? { snapshot: parsed.data, receivedAt, source } : null;
    },
});

const store = createMachineMetricsStore({
    load: loadMachineMetrics,
    startInterval: startRuntimeActiveGatedInterval,
    // Desktop background session sync may continue, but UI-only metrics need a visible host.
    isActive: () => isRuntimeActive() && isHostVisible(),
    subscribeActiveChange: subscribeToRuntimeActiveChange,
    persistence: {
        read: (key) => lastReadings.getSnapshot(key).data,
        write: (key, reading) => lastReadings.writeSuccess(key, reading, reading.receivedAt),
    },
});

export function useMachineMetricsPolling(scope: ServerAccountScope, targets: readonly MachineMetricsTarget[]) {
    const targetKey = JSON.stringify(targets);
    const targetsRef = React.useRef(targets);
    targetsRef.current = targets;
    const retained = React.useRef<ReturnType<typeof store.retain> | null>(null);
    React.useEffect(() => {
        const handle = store.retain(scope, targetsRef.current);
        retained.current = handle;
        return () => { handle.release(); if (retained.current === handle) retained.current = null; };
    }, [scope.serverId, scope.accountId]);
    React.useEffect(() => { retained.current?.updateTargets(targetsRef.current); }, [scope.serverId, scope.accountId, targetKey]);
}

export function useMachineMetrics(scope: ServerAccountScope, machineId: string) {
    const subscribe = React.useCallback((listener: () => void) => store.subscribe(scope, machineId, listener), [scope.serverId, scope.accountId, machineId]);
    const get = React.useCallback(() => store.get(scope, machineId), [scope.serverId, scope.accountId, machineId]);
    return React.useSyncExternalStore(subscribe, get, get);
}
