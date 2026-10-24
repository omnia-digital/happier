import * as React from 'react';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createMachineMetricsStore, type MachineMetricsTarget } from '@/sync/engine/machines/machineMetricsStore';
import { loadMachineMetrics } from '@/sync/ops/machineMetrics';
import { isRuntimeActive, startRuntimeActiveGatedInterval } from '@/utils/runtime/isRuntimeActive';

const store = createMachineMetricsStore({ load: loadMachineMetrics, startInterval: startRuntimeActiveGatedInterval, isActive: isRuntimeActive });

export function useMachineMetricsPolling(scope: ServerAccountScope, targets: readonly MachineMetricsTarget[]) {
    const targetKey = JSON.stringify(targets);
    const targetsRef = React.useRef(targets);
    targetsRef.current = targets;
    React.useEffect(() => store.retain(scope, targetsRef.current), [scope.serverId, scope.accountId, targetKey]);
}

export function useMachineMetrics(scope: ServerAccountScope, machineId: string) {
    const subscribe = React.useCallback((listener: () => void) => store.subscribe(scope, machineId, listener), [scope.serverId, scope.accountId, machineId]);
    const get = React.useCallback(() => store.get(scope, machineId), [scope.serverId, scope.accountId, machineId]);
    return React.useSyncExternalStore(subscribe, get, get);
}
