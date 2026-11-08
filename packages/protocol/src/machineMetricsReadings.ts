import type { MachineMetricsSnapshot } from './capabilities.js';

// Shared interpretation of raw host readings into MachineMetricsSnapshot fields.
// The CLI collector and the UI's released-CLI shell fallback both produce
// snapshots, so the measurement definitions live here once.

type Unavailable = Extract<MachineMetricsSnapshot['cpu'], { status: 'unavailable' }>;
type GpuDevices = Extract<MachineMetricsSnapshot['gpu'], { status: 'available' }>['devices'];

export function metricUnavailable(reason: Unavailable['reason']): Unavailable {
    return { status: 'unavailable', reason };
}

/** CPU tick counters for one logical core, or one aggregate line, as os.cpus() and /proc/stat report them. */
export type CpuTimes = Readonly<{ times: Readonly<{ user: number; nice: number; sys: number; idle: number; irq: number }> }>;

/** Busy share of all counted ticks between two samples; iowait, softirq and steal are not counted. */
export function cpuUsageFromSamples(before: readonly CpuTimes[], after: readonly CpuTimes[], sampleMs: number): MachineMetricsSnapshot['cpu'] {
    if (!before.length || before.length !== after.length || sampleMs <= 0) return metricUnavailable('invalid-data');
    let idle = 0;
    let total = 0;
    for (let i = 0; i < before.length; i++) {
        for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
            const delta = after[i].times[key] - before[i].times[key];
            if (!Number.isFinite(delta) || delta < 0) return metricUnavailable('invalid-data');
            total += delta;
            if (key === 'idle') idle += delta;
        }
    }
    return total > 0 ? { status: 'available', usagePercent: 100 * (total - idle) / total, sampleMs } : metricUnavailable('invalid-data');
}

export function loadAverageReading(averages: readonly number[]): MachineMetricsSnapshot['load'] {
    return averages.length === 3 && averages.every((value) => Number.isFinite(value) && value >= 0)
        ? { status: 'available', averages: [averages[0], averages[1], averages[2]] } : metricUnavailable('invalid-data');
}

export function utilizationPercent(usagePercent: number): { status: 'available'; usagePercent: number } | Unavailable {
    return Number.isFinite(usagePercent) && usagePercent >= 0 && usagePercent <= 100
        ? { status: 'available', usagePercent } : metricUnavailable('invalid-data');
}

export function capacityUsage(totalBytes: number, freeBytes: number): MachineMetricsSnapshot['memory'] {
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0 || freeBytes < 0 || freeBytes > totalBytes) return metricUnavailable('invalid-data');
    const usedBytes = totalBytes - freeBytes;
    return { status: 'available', totalBytes, usedBytes, usagePercent: 100 * usedBytes / totalBytes };
}

export function parseNvidiaGpuUtilization(stdout: string): GpuDevices {
    return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const fields = line.split(',').map((field) => field.trim());
        const id = fields.shift() ?? '';
        const rawUsage = fields.pop() ?? '';
        const name = fields.join(', ');
        const usagePercent = rawUsage ? Number(rawUsage) : NaN;
        return { id, name, utilization: utilizationPercent(usagePercent) };
    }).filter((device) => device.id && device.name);
}

export function parseWindowsGpuEngineUtilization(stdout: string): GpuDevices {
    const parsed: unknown = JSON.parse(stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const devices = new Map<string, { name: string; engines: Map<string, number>; invalid: boolean }>();
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const { Name, UtilizationPercentage } = row as Record<string, unknown>;
        if (typeof Name !== 'string') continue;
        const match = /^pid_\d+_(luid_0x[\da-f]+_0x[\da-f]+_phys_(\d+))_eng_(\d+)_engtype_/i.exec(Name);
        if (!match) continue;
        const [, id, physicalIndex, engine] = match;
        let device = devices.get(id);
        if (!device) { device = { name: `GPU ${physicalIndex} (${id})`, engines: new Map(), invalid: false }; devices.set(id, device); }
        const usage = typeof UtilizationPercentage === 'number' ? UtilizationPercentage
            : typeof UtilizationPercentage === 'string' && /^\d+(?:\.\d+)?$/.test(UtilizationPercentage) ? Number(UtilizationPercentage) : NaN;
        if (!Number.isFinite(usage) || usage < 0 || usage > 100) device.invalid = true;
        else device.engines.set(engine, (device.engines.get(engine) ?? 0) + usage);
    }
    return Array.from(devices, ([id, device]) => {
        // Instances are per process and physical engine. Sum processes sharing
        // one engine, then report that device's busiest engine (Task Manager's
        // definition), never the sum of independent engines or physical GPUs.
        const usagePercent = Math.max(...device.engines.values());
        return { id, name: device.name, utilization: !device.invalid && Number.isFinite(usagePercent) && usagePercent <= 100
            ? { status: 'available' as const, usagePercent } : metricUnavailable('invalid-data') };
    });
}

export function parseDarwinGpuUtilization(entries: readonly unknown[]): GpuDevices {
    const devices = new Map<string, GpuDevices[number]>();
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const { IORegistryEntryID, IORegistryEntryName, model, PerformanceStatistics } = entry as Record<string, unknown>;
        // plutil's raw integer preserves the full registry identity, including values
        // outside JavaScript's safe integer range.
        if (typeof IORegistryEntryID !== 'string' || !/^\d+$/.test(IORegistryEntryID)) continue;
        const id = `ioreg:${IORegistryEntryID}`;
        const name = (typeof model === 'string' && model.trim())
            || (typeof IORegistryEntryName === 'string' && IORegistryEntryName.trim()) || id;
        const statistics = PerformanceStatistics && typeof PerformanceStatistics === 'object'
            ? PerformanceStatistics as Record<string, unknown> : {};
        const usage = statistics['Device Utilization %'];
        // This is a best-effort driver property observed on Apple Silicon, not a
        // universal Apple API. Renderer/Tiler counters overlap; older scaled GPU
        // Core Utilization fields have no established percentage contract here.
        const utilization = !Object.hasOwn(statistics, 'Device Utilization %') ? metricUnavailable('no-supported-gpu')
            : typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 && usage <= 100
                ? { status: 'available' as const, usagePercent: usage } : metricUnavailable('invalid-data');
        const previous = devices.get(id);
        if (!previous) devices.set(id, { id, name, utilization });
        else if (JSON.stringify(previous.utilization) !== JSON.stringify(utilization)) {
            devices.set(id, { ...previous, utilization: metricUnavailable('invalid-data') });
        }
    }
    return [...devices.values()];
}
