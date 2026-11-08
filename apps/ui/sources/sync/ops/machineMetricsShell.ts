import {
    capacityUsage, MachineMetricsSnapshotSchema, metricUnavailable, parseDarwinGpuUtilization, parseNvidiaGpuUtilization,
    parseWindowsGpuEngineUtilization, type MachineMetricsSnapshot,
} from '@happier-dev/protocol/capabilities';

/*
 * Host metrics for released CLIs (0.2.12 through at least 0.2.20) that predate the
 * `tool.machineMetrics` capability. Every released daemon registers the session
 * `bash` RPC on its machine connection, so one fixed, read-only, argv-only command
 * per platform yields the same raw readings the CLI collector reads. The shared
 * protocol interpreters turn them into the same snapshot shape.
 *
 * Remove this path once every supported host runs a metrics-capable CLI.
 */

type Snapshot = MachineMetricsSnapshot;
type Unavailable = Extract<Snapshot['cpu'], { status: 'unavailable' }>;
type GpuDevices = Extract<Snapshot['gpu'], { status: 'available' }>['devices'];

// Absolute tool paths: the daemon's PATH is not guaranteed to include system dirs.
const DARWIN_SCRIPT = String.raw`cd "$HOME" 2>/dev/null && printf '@home\t%s\n' "$(pwd -P)"
printf '@memsize\t%s\n' "$(/usr/sbin/sysctl -n hw.memsize)"
printf '@loadavg\t%s\n' "$(/usr/sbin/sysctl -n vm.loadavg)"
/usr/bin/vm_stat | /usr/bin/awk '/page size of/ { for (i = 1; i < NF; i++) if ($i == "of") print "@pagesize\t" $(i + 1) } /^Pages free:/ { sub(/\./, "", $3); print "@pagesfree\t" $3 }'
/bin/df -kP "$HOME" | /usr/bin/awk 'NR > 1 { print "@df\t" $0 }'
/usr/bin/top -l 2 -n 0 -s 1 | /usr/bin/awk '/^CPU usage/ { line = $0 } END { if (line != "") print "@cpu\t" line }'
x=$(/usr/sbin/ioreg -r -c IOAccelerator -d 1 -a 2>/dev/null)
i=0
while t=$(printf '%s' "$x" | /usr/bin/plutil -type "$i" - 2>/dev/null); do
  f() { printf '%s' "$x" | /usr/bin/plutil -extract "$i.$1" "$2" -o - - 2>/dev/null; }
  printf '@gpu\t%s\t%s\t%s\t%s\t%s\n' "$t" "$(f IORegistryEntryID raw)" "$(f IORegistryEntryName raw)" "$(f model raw)" "$(f PerformanceStatistics json)"
  i=$((i + 1))
done
exit 0
`;

const LINUX_SCRIPT = String.raw`cd "$HOME" 2>/dev/null && printf '@home\t%s\n' "$(pwd -P)"
awk '/^(MemTotal|MemAvailable|MemFree):/ { print "@meminfo\t" $1 "\t" $2 }' /proc/meminfo
printf '@loadavg\t%s\n' "$(cat /proc/loadavg)"
df -kP "$HOME" | awk 'NR > 1 { print "@df\t" $0 }'
awk 'NR == 1 { print "@stat\t" $0 }' /proc/stat; sleep 1; awk 'NR == 1 { print "@stat\t" $0 }' /proc/stat
for f in /sys/class/drm/card*/device/gpu_busy_percent; do [ -r "$f" ] && printf '@amdgpu\t%s\t%s\n' "$(basename "$(dirname "$(dirname "$f")")")" "$(cat "$f")"; done
command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=uuid,name,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | awk '{ print "@nvidia\t" $0 }'
exit 0
`;

// CPU counters exceed Number.MAX_SAFE_INTEGER, so they travel as strings.
const WIN32_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
function Read-Optional([scriptblock]$Read) { try { & $Read } catch { $null } }
$cpuSample = { Get-CimInstance Win32_PerfRawData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object @{ n = 'idle'; e = { [string]$_.PercentProcessorTime } }, @{ n = 'time'; e = { [string]$_.Timestamp_Sys100NS } } }
$cpu1 = Read-Optional $cpuSample
Start-Sleep -Milliseconds 1000
$cpu2 = Read-Optional $cpuSample
ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{
  home = $env:USERPROFILE
  memory = Read-Optional { Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory }
  disk = Read-Optional { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:HOMEDRIVE'" | Select-Object DeviceID, Size, FreeSpace }
  cpu = @($cpu1, $cpu2)
  gpu = Read-Optional { , @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name, UtilizationPercentage) }
})
`;

export function buildShellMetricsArgv(platform: string | null | undefined): readonly string[] | null {
    if (platform === 'darwin') return ['/bin/sh', '-c', DARWIN_SCRIPT];
    if (platform === 'linux') return ['/bin/sh', '-c', LINUX_SCRIPT];
    if (platform === 'win32') return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WIN32_SCRIPT];
    return null;
}

type Readings = Readonly<Omit<Snapshot, 'version' | 'machineId' | 'platform' | 'sampledAt' | 'collectionMs'>>;
const finite = (raw: unknown): number => (typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN);
const percentage = (usagePercent: number) => (Number.isFinite(usagePercent) && usagePercent >= 0 && usagePercent <= 100
    ? { status: 'available' as const, usagePercent } : metricUnavailable('invalid-data'));

function taggedLines(stdout: string): Map<string, string[][]> {
    const tagged = new Map<string, string[][]>();
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('@')) continue;
        const [tag, ...fields] = line.split('\t');
        tagged.set(tag.slice(1), [...(tagged.get(tag.slice(1)) ?? []), fields]);
    }
    return tagged;
}

/** POSIX `df -kP` data row: capacity is the `N%` field; the mount point may contain spaces. */
function storageFromDf(row: string | undefined, home: string | undefined): Snapshot['storage'] {
    if (!row || !home) return metricUnavailable('collection-failed');
    const fields = row.trim().split(/\s+/);
    const capacityIndex = fields.findIndex((field, index) => index >= 4 && /^\d+%$/.test(field));
    if (capacityIndex < 0) return metricUnavailable('invalid-data');
    const totalBytes = finite(fields[capacityIndex - 3]) * 1024;
    const usedBytes = finite(fields[capacityIndex - 2]) * 1024;
    const usage = capacityUsage(totalBytes, totalBytes - usedBytes);
    const volume = fields.slice(capacityIndex + 1).join(' ');
    return usage.status === 'available' && volume ? { ...usage, filesystemPath: home, volume } : metricUnavailable('invalid-data');
}

function loadFrom(values: readonly string[]): Snapshot['load'] {
    const averages = values.slice(0, 3).map(finite);
    return averages.length === 3 && averages.every((value) => Number.isFinite(value) && value >= 0)
        ? { status: 'available', averages: [averages[0], averages[1], averages[2]] } : metricUnavailable('invalid-data');
}

const gpuFrom = (devices: GpuDevices, failed: Unavailable | null = null): Snapshot['gpu'] => (devices.length
    ? { status: 'available', devices: [devices[0], ...devices.slice(1)] } : failed ?? metricUnavailable('no-supported-gpu'));

function parseDarwin(stdout: string): Readings | null {
    const lines = taggedLines(stdout);
    const first = (tag: string) => lines.get(tag)?.[0]?.[0];
    if (!lines.has('home') && !lines.has('memsize') && !lines.has('cpu')) return null;
    const idleText = /([\d.]+)% idle/.exec(first('cpu') ?? '')?.[1];
    const idle = finite(idleText);
    const memsize = finite(first('memsize'));
    const loadValues = (first('loadavg') ?? '').replace(/[{}]/g, ' ').trim().split(/\s+/);
    const gpuRows = lines.get('gpu') ?? [];
    const gpu = gpuRows.some(([type]) => type !== 'dictionary') ? metricUnavailable('invalid-data')
        : gpuFrom(parseDarwinGpuUtilization(gpuRows.map(([, IORegistryEntryID, IORegistryEntryName, model, statistics]) => {
            let PerformanceStatistics: unknown;
            try { PerformanceStatistics = statistics ? JSON.parse(statistics) : undefined; } catch { PerformanceStatistics = undefined; }
            return { IORegistryEntryID, IORegistryEntryName, model, PerformanceStatistics };
        })));
    return {
        // top's second sample covers the 1 s interval between its two samples.
        cpu: idleText === undefined ? metricUnavailable('collection-failed')
            : idle <= 100 ? { status: 'available', usagePercent: 100 - idle, sampleMs: 1000 } : metricUnavailable('invalid-data'),
        // Matches the CLI's os.freemem() on macOS: free pages only, so cache counts as used.
        memory: Number.isFinite(memsize) ? capacityUsage(memsize, finite(first('pagesfree')) * finite(first('pagesize'))) : metricUnavailable('collection-failed'),
        storage: storageFromDf(first('df'), first('home')),
        gpu,
        load: first('loadavg') === undefined ? metricUnavailable('collection-failed') : loadFrom(loadValues),
    };
}

function parseLinux(stdout: string): Readings | null {
    const lines = taggedLines(stdout);
    if (!lines.has('home') && !lines.has('meminfo') && !lines.has('stat')) return null;
    const meminfo = new Map((lines.get('meminfo') ?? []).map(([key, kib]) => [key.replace(/:$/, ''), finite(kib) * 1024]));
    // Same fields libuv's os.cpus() reads: user, nice, system, idle and irq; iowait is excluded.
    const samples = (lines.get('stat') ?? []).map(([row]) => row.trim().split(/\s+/).slice(1).map(finite));
    let cpu: Snapshot['cpu'] = metricUnavailable('collection-failed');
    if (samples.length === 2) {
        const delta = (index: number) => samples[1][index] - samples[0][index];
        const [user, nice, system, idle, irq] = [delta(0), delta(1), delta(2), delta(3), delta(5)];
        const total = user + nice + system + idle + irq;
        cpu = [user, nice, system, idle, irq].every((value) => Number.isFinite(value) && value >= 0) && total > 0
            ? { status: 'available', usagePercent: 100 * (total - idle) / total, sampleMs: 1000 } : metricUnavailable('invalid-data');
    }
    const amd = (lines.get('amdgpu') ?? []).map(([id, raw]) => ({ id, name: id, utilization: percentage(finite(raw)) }));
    const nvidia = parseNvidiaGpuUtilization((lines.get('nvidia') ?? []).map(([row]) => row).join('\n'));
    const memTotal = meminfo.get('MemTotal');
    const memAvailable = meminfo.get('MemAvailable') ?? meminfo.get('MemFree');
    return {
        cpu,
        // Matches the CLI's os.freemem() on Linux: libuv reads MemAvailable and falls
        // back to free memory on kernels that lack it (seen on WSL Ubuntu).
        memory: memTotal === undefined || memAvailable === undefined ? metricUnavailable('collection-failed') : capacityUsage(memTotal, memAvailable),
        storage: storageFromDf(lines.get('df')?.[0]?.[0], lines.get('home')?.[0]?.[0]),
        gpu: gpuFrom([...amd.filter((device) => device.id), ...nvidia]),
        load: lines.has('loadavg') ? loadFrom((lines.get('loadavg')?.[0]?.[0] ?? '').trim().split(/\s+/)) : metricUnavailable('collection-failed'),
    };
}

function parseWin32(stdout: string): Readings | null {
    const json = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
    if (!json) return null;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
    const memory = record(parsed.memory);
    const disk = record(parsed.disk);
    const home = typeof parsed.home === 'string' ? parsed.home : '';
    const samples = Array.isArray(parsed.cpu) ? parsed.cpu.map(record) : [];
    let cpu: Snapshot['cpu'] = metricUnavailable('collection-failed');
    const integer = (value: unknown) => (typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null);
    if (samples.length === 2 && samples[0] && samples[1]) {
        const [idle0, time0, idle1, time1] = [integer(samples[0].idle), integer(samples[0].time), integer(samples[1].idle), integer(samples[1].time)];
        if (idle0 === null || time0 === null || idle1 === null || time1 === null || time1 <= time0 || idle1 < idle0) cpu = metricUnavailable('invalid-data');
        else {
            // PercentProcessorTime is an inverse 100 ns timer: it accumulates idle time.
            const idleRatio = Number(idle1 - idle0) / Number(time1 - time0);
            cpu = idleRatio > 1 ? metricUnavailable('invalid-data')
                : { status: 'available', usagePercent: 100 * (1 - idleRatio), sampleMs: Number(time1 - time0) / 10_000 };
        }
    }
    let gpu: Snapshot['gpu'];
    if (!Array.isArray(parsed.gpu)) gpu = metricUnavailable('collection-failed');
    else {
        try { gpu = gpuFrom(parseWindowsGpuEngineUtilization(JSON.stringify(parsed.gpu))); } catch { gpu = metricUnavailable('invalid-data'); }
    }
    const diskUsage = disk ? capacityUsage(finite(disk.Size), finite(disk.FreeSpace)) : metricUnavailable('collection-failed');
    const drive = typeof disk?.DeviceID === 'string' ? disk.DeviceID : '';
    return {
        cpu,
        memory: memory ? capacityUsage(finite(memory.TotalVisibleMemorySize) * 1024, finite(memory.FreePhysicalMemory) * 1024) : metricUnavailable('collection-failed'),
        storage: diskUsage.status === 'available' && drive && home ? { ...diskUsage, filesystemPath: home, volume: `${drive}\\` }
            : diskUsage.status === 'available' ? metricUnavailable('invalid-data') : diskUsage,
        gpu,
        load: metricUnavailable('unsupported-platform'),
    };
}

/** Builds a validated snapshot, or null when the output carries no readings at all. */
export function parseShellMetrics(params: Readonly<{
    platform: string; machineId: string; stdout: string; sampledAt: number; collectionMs: number;
}>): Snapshot | null {
    const readings = params.platform === 'darwin' ? parseDarwin(params.stdout)
        : params.platform === 'linux' ? parseLinux(params.stdout)
            : params.platform === 'win32' ? parseWin32(params.stdout) : null;
    if (!readings) return null;
    if ([readings.cpu, readings.memory, readings.storage].every((metric) => metric.status === 'unavailable')) return null;
    const parsed = MachineMetricsSnapshotSchema.safeParse({ version: 1, machineId: params.machineId, platform: params.platform,
        sampledAt: params.sampledAt, collectionMs: params.collectionMs, ...readings });
    return parsed.success ? parsed.data : null;
}
