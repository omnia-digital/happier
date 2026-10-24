import * as React from 'react';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createMachineMetricsStore, type MachineMetricsTarget } from '@/sync/engine/machines/machineMetricsStore';
import { loadMachineMetrics } from '@/sync/ops/machineMetrics';
import { isRuntimeActive, startRuntimeActiveGatedInterval, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';

const store = createMachineMetricsStore({ load: loadMachineMetrics, startInterval: startRuntimeActiveGatedInterval, isActive: isRuntimeActive, subscribeActiveChange: subscribeToRuntimeActiveChange });

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
