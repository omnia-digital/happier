import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, realpath, stat, statfs } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { finished } from 'node:stream/promises';
import {
    capacityUsage, cpuUsageFromSamples, loadAverageReading, MachineMetricsSnapshotSchema, metricUnavailable as unavailable,
    parseDarwinGpuUtilization, parseNvidiaGpuUtilization, parseWindowsGpuEngineUtilization, utilizationPercent, type MachineMetricsSnapshot,
} from '@happier-dev/protocol/capabilities';

const execFileAsync = promisify(execFile);
type Unavailable = Extract<MachineMetricsSnapshot['cpu'], { status: 'unavailable' }>;
function failure(error: unknown): Unavailable {
    const code = (error as NodeJS.ErrnoException)?.code;
    return unavailable(code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'collection-failed');
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

async function collectDarwinGpu(signal?: AbortSignal): Promise<MachineMetricsSnapshot['gpu']> {
    const { stdout: plist } = await execFileAsync('/usr/sbin/ioreg', ['-r', '-c', 'IOAccelerator', '-d', '1', '-a'], {
        encoding: 'utf8', ...(signal ? { signal } : {}),
    });
    const plutil = async (args: string[]): Promise<string> => {
        signal?.throwIfAborted();
        const result = execFileAsync('/usr/bin/plutil', [...args, '-'], { encoding: 'utf8', ...(signal ? { signal } : {}) });
        const input = result.child.stdin!;
        // A deadline can close the pipe before the registry buffer is written.
        // Own that stream error as part of the query, and stop a child whose input failed.
        const written = finished(input, { readable: false, cleanup: true }).catch((error) => {
            result.child.kill();
            throw error;
        });
        input.end(plist);
        const [{ stdout }] = await Promise.all([result, written]);
        return stdout.trim();
    };
    // Validate once so an absent indexed entry is distinguishable from a malformed
    // document. Keep the registry data in memory; never log or persist its private fields.
    await plutil(['-lint', '-s']);
    const optional = async (args: string[]): Promise<string | null> => {
        try { return await plutil(args); } catch (error) {
            signal?.throwIfAborted();
            // plutil reports missing keys and unsupported JSON value types with exit 1.
            if ((error as { code?: unknown }).code === 1) return null;
            throw error;
        }
    };
    const entries: unknown[] = [];
    for (let index = 0; ; index++) {
        const type = await optional(['-type', String(index)]);
        if (type === null) break;
        if (type !== 'dictionary') return unavailable('invalid-data');
        const [IORegistryEntryID, IORegistryEntryName, model, statistics] = await Promise.all([
            optional(['-extract', `${index}.IORegistryEntryID`, 'raw', '-expect', 'integer', '-o', '-']),
            optional(['-extract', `${index}.IORegistryEntryName`, 'raw', '-expect', 'string', '-o', '-']),
            optional(['-extract', `${index}.model`, 'raw', '-expect', 'string', '-o', '-']),
            // Whole-registry JSON conversion fails on unrelated CFData properties.
            optional(['-extract', `${index}.PerformanceStatistics`, 'json', '-o', '-']),
        ]);
        entries.push({ IORegistryEntryID, IORegistryEntryName, model, PerformanceStatistics: statistics ? JSON.parse(statistics) : undefined });
    }
    const devices = parseDarwinGpuUtilization(entries);
    return devices.length ? { status: 'available', devices } : unavailable('no-supported-gpu');
}

async function collectGpu(signal?: AbortSignal): Promise<MachineMetricsSnapshot['gpu']> {
    if (process.platform === 'darwin') {
        try { return await collectDarwinGpu(signal); }
        catch (error) { signal?.throwIfAborted(); return failure(error); }
    }
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
                    devices.push({ id: card, name: card, utilization: utilizationPercent(usagePercent) });
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
    const load: MachineMetricsSnapshot['load'] = process.platform === 'win32' ? unavailable('unsupported-platform') : loadAverageReading(os.loadavg());
    return MachineMetricsSnapshotSchema.parse({ version: 1, machineId, platform: process.platform,
        sampledAt: Date.now(), collectionMs: performance.now() - started, cpu, memory, storage, gpu, load });
}
