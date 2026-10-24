import { z } from 'zod';

export type CapabilityKind = 'cli' | 'tool' | 'dep';

export const MACHINE_METRICS_CAPABILITY_ID = 'tool.machineMetrics' as const;
export const MACHINE_METRICS_REFRESH_MS = 180_000;
// Existing interactive capability-invoke budget, shared by its UI owner and the
// receiving host snapshot. Effectful capabilities may explicitly request longer.
export const DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS = 30_000;
export const MachineMetricsSnapshotRequestSchema = z.object({
  timeoutMs: z.number().int().positive().max(DEFAULT_CAPABILITIES_INVOKE_TIMEOUT_MS),
});
const metricUnavailable = z.object({ status: z.literal('unavailable'), reason: z.enum([
  'unsupported-platform', 'no-supported-gpu', 'permission-denied', 'collection-failed', 'invalid-data',
]) });
const percentage = z.number().finite().min(0).max(100);
const bytes = z.number().finite().nonnegative();
const capacity = z.object({ status: z.literal('available'), usagePercent: percentage, usedBytes: bytes, totalBytes: bytes.positive() });
export const MachineMetricsSnapshotSchema = z.object({
  version: z.literal(1),
  machineId: z.string().min(1),
  platform: z.string().min(1),
  sampledAt: z.number().finite().nonnegative(),
  collectionMs: z.number().finite().nonnegative(),
  cpu: z.union([z.object({ status: z.literal('available'), usagePercent: percentage, sampleMs: z.number().finite().positive() }), metricUnavailable]),
  // Physical nonfree memory, including filesystem cache; this is not memory pressure.
  memory: z.union([capacity, metricUnavailable]),
  storage: z.union([capacity.extend({ filesystemPath: z.string().min(1), volume: z.string().min(1) }), metricUnavailable]),
  gpu: z.union([z.object({ status: z.literal('available'), devices: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), utilization: z.union([
      z.object({ status: z.literal('available'), usagePercent: percentage }), metricUnavailable,
    ]),
  })).nonempty() }), metricUnavailable]),
  load: z.union([z.object({ status: z.literal('available'), averages: z.tuple([
    z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative(),
  ]) }), metricUnavailable]),
});
export type MachineMetricsSnapshot = z.infer<typeof MachineMetricsSnapshotSchema>;

// Capability IDs are namespaced strings returned by the daemon.
// Keep this flexible so new capabilities (including new `cli.<agent>` ids) do not require UI code changes.
export type CapabilityId = `cli.${string}` | `tool.${string}` | `dep.${string}`;

export type CapabilityDetectRequest = {
  id: CapabilityId;
  params?: Record<string, unknown>;
};

export type CapabilityDescriptor = {
  id: CapabilityId;
  kind: CapabilityKind;
  title?: string;
  methods?: Record<string, { title?: string }>;
};

export type CapabilitiesDescribeResponse = {
  protocolVersion: 1;
  capabilities: CapabilityDescriptor[];
  checklists: Record<string, CapabilityDetectRequest[]>;
};

export type CapabilityDetectResult =
  | { ok: true; checkedAt: number; data: unknown }
  | { ok: false; checkedAt: number; error: { message: string; code?: string } };

export type CapabilitiesDetectResponse = {
  protocolVersion: 1;
  results: Partial<Record<CapabilityId, CapabilityDetectResult>>;
};

export type CapabilitiesDetectRequest = {
  checklistId?: string;
  requests?: CapabilityDetectRequest[];
  overrides?: Partial<Record<CapabilityId, { params?: Record<string, unknown> }>>;
  bypassCache?: boolean;
};

export type CapabilitiesInvokeRequest = {
  id: CapabilityId;
  method: string;
  params?: Record<string, unknown>;
};

export type CapabilitiesInvokeResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; code?: string }; logPath?: string };
