import { MACHINE_METRICS_CAPABILITY_ID, MachineMetricsSnapshotSchema } from '@happier-dev/protocol/capabilities';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { MachineMetricsLoadResult } from '@/sync/engine/machines/machineMetricsStore';
import { machineCapabilitiesInvoke } from './capabilities';

export async function loadMachineMetrics(scope: ServerAccountScope, machineId: string): Promise<MachineMetricsLoadResult> {
    const result = await machineCapabilitiesInvoke(machineId, { id: MACHINE_METRICS_CAPABILITY_ID, method: 'snapshot' }, scope);
    if (!result.supported) return { status: result.reason === 'not-supported' ? 'unsupported' : 'error' };
    if (!result.response.ok) return { status: ['unsupported-capability', 'unknown-capability', 'unsupported-method'].includes(result.response.error.code ?? '') ? 'unsupported' : 'error' };
    const parsed = MachineMetricsSnapshotSchema.safeParse(result.response.result);
    if (!parsed.success || parsed.data.machineId !== machineId) return { status: 'error' };
    return { status: 'ready', snapshot: parsed.data };
}
