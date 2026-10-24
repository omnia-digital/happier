import { MACHINE_METRICS_CAPABILITY_ID } from '@happier-dev/protocol/capabilities';
import { collectHostMetrics } from '@/integrations/systemMetrics/collectHostMetrics';
import type { Capability } from '../service';

export function createMachineMetricsCapability(machineId: string): Capability {
    return {
        descriptor: { id: MACHINE_METRICS_CAPABILITY_ID, kind: 'tool', title: 'Host resource metrics', methods: { snapshot: { title: 'Read host metrics' } } },
        detect: async () => ({ available: true }),
        invoke: async ({ method, signal }) => method === 'snapshot'
            ? { ok: true, result: await collectHostMetrics(machineId, signal) }
            : { ok: false, error: { code: 'unsupported-method', message: 'Unsupported metrics method' } },
    };
}
