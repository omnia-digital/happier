import { MACHINE_METRICS_CAPABILITY_ID, MachineMetricsSnapshotRequestSchema } from '@happier-dev/protocol/capabilities';
import { collectHostMetrics } from '@/integrations/systemMetrics/collectHostMetrics';
import type { Capability } from '../service';

export function createMachineMetricsCapability(machineId: string): Capability {
    return {
        descriptor: { id: MACHINE_METRICS_CAPABILITY_ID, kind: 'tool', title: 'Host resource metrics', methods: { snapshot: { title: 'Read host metrics' } } },
        detect: async () => ({ available: true }),
        invoke: async ({ method, params, signal }) => {
            if (method !== 'snapshot') return { ok: false, error: { code: 'unsupported-method', message: 'Unsupported metrics method' } };
            const request = MachineMetricsSnapshotRequestSchema.safeParse(params);
            if (!request.success) return { ok: false, error: { code: 'invalid-request', message: 'A bounded host collection budget is required' } };
            const controller = new AbortController();
            const onAbort = () => controller.abort(signal?.reason);
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            // This receiving collection budget travels inside the new encrypted
            // capability payload, including through relays that do not forward
            // caller timeouts/correlation. It is not a cross-host wall-clock deadline.
            const timer = setTimeout(() => controller.abort(new Error('Host metrics collection timed out')), request.data.timeoutMs);
            try {
                return { ok: true, result: await collectHostMetrics(machineId, controller.signal) };
            } catch (error) {
                if (controller.signal.aborted && !signal?.aborted) return { ok: false, error: { code: 'collection-timeout', message: 'Host metrics collection timed out' } };
                throw error;
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
            }
        },
    };
}
