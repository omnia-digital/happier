import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, realpath, stat, statfs } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { MachineMetricsSnapshotSchema, type MachineMetricsSnapshot } from '@happier-dev/protocol/capabilities';

const execFileAsync = promisify(execFile);
type Unavailable = Extract<MachineMetricsSnapshot['cpu'], { status: 'unavailable' }>;
const unavailable = (reason: Unavailable['reason']): Unavailable => ({ status: 'unavailable', reason });
function failure(error: unknown): Unavailable {
    const code = (error as NodeJS.ErrnoException)?.code;
    return unavailable(code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'collection-failed');
}

export function cpuUsageFromSamples(before: os.CpuInfo[], after: os.CpuInfo[], sampleMs: number): MachineMetricsSnapshot['cpu'] {
    if (!before.length || before.length !== after.length || sampleMs <= 0) return unavailable('invalid-data');
    let idle = 0;
    let total = 0;
    for (let i = 0; i < before.length; i++) {
        for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
            const delta = after[i].times[key] - before[i].times[key];
            if (!Number.isFinite(delta) || delta < 0) return unavailable('invalid-data');
            total += delta;
            if (key === 'idle') idle += delta;
        }
    }
    return total > 0 ? { status: 'available', usagePercent: 100 * (total - idle) / total, sampleMs } : unavailable('invalid-data');
}

export function capacityUsage(totalBytes: number, freeBytes: number): MachineMetricsSnapshot['memory'] {
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0 || freeBytes < 0 || freeBytes > totalBytes) return unavailable('invalid-data');
    const usedBytes = totalBytes - freeBytes;
    return { status: 'available', totalBytes, usedBytes, usagePercent: 100 * usedBytes / totalBytes };
}

async function collectStorage(): Promise<MachineMetricsSnapshot['storage']> {
    try {
        const filesystemPath = await realpath(os.homedir());
        const [fs, origin] = await Promise.all([statfs(filesystemPath), stat(filesystemPath)]);
        const usage = capacityUsage(fs.bsize * fs.blocks, fs.bsize * fs.bfree);
        if (usage.status !== 'available') return usage;
        // Identify the accessible volume boundary by device, including Windows drive/UNC roots.
        // This also respects container mount namespaces instead of inventing a physical disk.
        let volume = filesystemPath;
        while (path.dirname(volume) !== volume) {
            const parent = path.dirname(volume);
            if ((await stat(parent)).dev !== origin.dev) break;
            volume = parent;
        }
        return { ...usage, filesystemPath, volume };
    } catch (error) {
        return failure(error);
    }
}

export function parseNvidiaGpuUtilization(stdout: string): Extract<MachineMetricsSnapshot['gpu'], { status: 'available' }>['devices'] {
    return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const fields = line.split(',').map((field) => field.trim());
        const id = fields.shift() ?? '';
        const rawUsage = fields.pop() ?? '';
        const name = fields.join(', ');
        const usagePercent = rawUsage ? Number(rawUsage) : NaN;
        return {
            id, name,
            utilization: Number.isFinite(usagePercent) && usagePercent >= 0 && usagePercent <= 100
                ? { status: 'available' as const, usagePercent }
                : unavailable('invalid-data'),
        };
    }).filter((device) => device.id && device.name);
}

export function parseWindowsGpuEngineUtilization(stdout: string): Extract<MachineMetricsSnapshot['gpu'], { status: 'available' }>['devices'] {
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
            ? { status: 'available' as const, usagePercent } : unavailable('invalid-data') };
    });
}

async function collectGpu(signal?: AbortSignal): Promise<MachineMetricsSnapshot['gpu']> {
    if (process.platform !== 'linux' && process.platform !== 'win32') return unavailable('no-supported-gpu');
    if (process.platform === 'win32') {
        try {
            const result = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
                "$ErrorActionPreference='Stop'; $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Select-Object Name,UtilizationPercentage); ConvertTo-Json -InputObject $rows -Compress",
            ], { encoding: 'utf8', windowsHide: true, ...(signal ? { signal } : {}) });
            const devices = parseWindowsGpuEngineUtilization(result.stdout);
            return devices.length ? { status: 'available', devices } : unavailable('no-supported-gpu');
        } catch (error) { signal?.throwIfAborted(); return failure(error); }
    }
    const devices: Extract<MachineMetricsSnapshot['gpu'], { status: 'available' }>['devices'] = [];
    let queryFailure: Unavailable | null = null;
    if (process.platform === 'linux') {
        try {
            const cards = (await readdir('/sys/class/drm')).filter((card) => /^card\d+$/.test(card));
            for (const card of cards) {
                signal?.throwIfAborted();
                try {
                    // AMDGPU's documented read-only percentage of GPU engine activity.
                    const raw = (await readFile(`/sys/class/drm/${card}/device/gpu_busy_percent`, 'utf8')).trim();
                    const usagePercent = raw ? Number(raw) : NaN;
                    devices.push({ id: card, name: card, utilization: Number.isFinite(usagePercent) && usagePercent >= 0 && usagePercent <= 100
                        ? { status: 'available', usagePercent } : unavailable('invalid-data') });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') queryFailure = failure(error);
                }
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') queryFailure = failure(error);
        }
    }
    try {
        // One read, no shell, daemon or privilege escalation. The containing machine RPC
        // owns cancellation/deadline; do not create a shorter competing probe timeout.
        const result = await execFileAsync('nvidia-smi', [
            '--query-gpu=uuid,name,utilization.gpu', '--format=csv,noheader,nounits',
        ], { encoding: 'utf8', windowsHide: true, ...(signal ? { signal } : {}) });
        devices.push(...parseNvidiaGpuUtilization(result.stdout));
    } catch (error) {
        signal?.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') queryFailure = failure(error);
    }
    return devices.length ? { status: 'available', devices } : queryFailure ?? unavailable('no-supported-gpu');
}

export async function collectHostMetrics(machineId: string, signal?: AbortSignal): Promise<MachineMetricsSnapshot> {
    signal?.throwIfAborted();
    const started = performance.now();
    const before = os.cpus();
    // A one-second CPU observation window, not a one-second blocking sleep. Other
    // measurements and daemon/session work continue while CPU counters accumulate.
    const [storage, gpu] = await Promise.all([
        collectStorage(), collectGpu(signal), delay(1_000, undefined, { signal }),
    ]);
    signal?.throwIfAborted();
    const cpu = cpuUsageFromSamples(before, os.cpus(), performance.now() - started);
    const memory = capacityUsage(os.totalmem(), os.freemem());
    const averages = os.loadavg();
    const load: MachineMetricsSnapshot['load'] = process.platform === 'win32' ? unavailable('unsupported-platform')
        : averages.length === 3 && averages.every((value) => Number.isFinite(value) && value >= 0)
            ? { status: 'available', averages: [averages[0], averages[1], averages[2]] } : unavailable('invalid-data');
    return MachineMetricsSnapshotSchema.parse({ version: 1, machineId, platform: process.platform,
        sampledAt: Date.now(), collectionMs: performance.now() - started, cpu, memory, storage, gpu, load });
}
