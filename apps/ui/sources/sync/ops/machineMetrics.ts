import { DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS, MACHINE_METRICS_CAPABILITY_ID, MachineMetricsSnapshotSchema } from '@happier-dev/protocol/capabilities';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { MachineMetricsLoadResult } from '@/sync/engine/machines/machineMetricsStore';
import { machineCapabilitiesInvoke } from './capabilities';
import { machineBash } from './machines';
import { buildShellMetricsArgv, parseShellMetrics } from './machineMetricsShell';

export async function loadMachineMetrics(scope: ServerAccountScope, machineId: string, platform?: string | null): Promise<MachineMetricsLoadResult> {
    const result = await machineCapabilitiesInvoke(machineId, {
        id: MACHINE_METRICS_CAPABILITY_ID, method: 'snapshot', params: { timeoutMs: DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS },
    }, { ...scope, timeoutMs: DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS });
    if (!result.supported) return result.reason === 'not-supported' ? await loadReleasedCliMetrics(scope, machineId, platform) : { status: 'error' };
    if (!result.response.ok) {
        return ['unsupported-capability', 'unknown-capability', 'unsupported-method'].includes(result.response.error.code ?? '')
            ? await loadReleasedCliMetrics(scope, machineId, platform) : { status: 'error' };
    }
    const parsed = MachineMetricsSnapshotSchema.safeParse(result.response.result);
    if (!parsed.success || parsed.data.machineId !== machineId) return { status: 'error' };
    return { status: 'ready', source: 'capability', snapshot: parsed.data };
}

/** A host whose CLI lacks the metrics capability: read it through the released machine shell RPC. */
async function loadReleasedCliMetrics(scope: ServerAccountScope, machineId: string, platform: string | null | undefined): Promise<MachineMetricsLoadResult> {
    const argv = buildShellMetricsArgv(platform);
    if (!argv || !platform) return { status: 'unsupported' };
    const started = Date.now();
    const response = await machineBash(machineId, { argv }, '/', { ...scope, timeoutMs: DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS });
    const sampledAt = Date.now();
    // Only a daemon without the shell handler is unsupported. A timeout, dropped connection, failed
    // spawn or unreadable output is a read failure that the next refresh retries.
    if (response.rpcErrorCode === RPC_ERROR_CODES.METHOD_NOT_FOUND || response.rpcErrorCode === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE) return { status: 'unsupported' };
    const snapshot = response.success
        ? parseShellMetrics({ platform, machineId, stdout: response.stdout, sampledAt, collectionMs: sampledAt - started })
        : null;
    return snapshot ? { status: 'ready', source: 'shell', snapshot } : { status: 'error' };
}
