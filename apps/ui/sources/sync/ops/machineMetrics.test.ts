import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMachineMetrics } from './machineMetrics';
import { darwinShellMetricsStdout, linuxShellMetricsStdout, win32ShellMetricsStdout, wslLinuxShellMetricsStdout } from '@/dev/testkit/fixtures/machineMetricsShellFixtures';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
const scope = { serverId: 'server-a', accountId: 'account-a' };
const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
const reading = (machineId = 'host-a') => ({ version: 1, machineId, platform: 'linux', sampledAt: 1, collectionMs: 1000,
    cpu: { status: 'available', usagePercent: 0, sampleMs: 1000 }, memory: absent, storage: absent, gpu: absent, load: absent });
beforeEach(() => { rpc.mockReset(); });
describe('machine metrics encrypted transport adapter', () => {
    it('pins reads to the receiving Home/account machine and distinguishes a measured zero from unavailable values', async () => {
        rpc.mockResolvedValue({ ok: true, result: reading() });
        const result = await loadMachineMetrics(scope, 'host-a');
        expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'host-a', serverId: 'server-a', accountId: 'account-a',
            payload: { id: 'tool.machineMetrics', method: 'snapshot', params: { timeoutMs: 30_000 } }, timeoutMs: 30_000 }));
        expect(result).toMatchObject({ status: 'ready', snapshot: { cpu: { status: 'available', usagePercent: 0 }, gpu: { status: 'unavailable' } } });
    });
    it('rejects wrong-machine, out-of-range and malformed telemetry without using it', async () => {
        for (const result of [reading('wrong-host'), { ...reading(), cpu: { status: 'available', usagePercent: 101, sampleMs: 1000 } }, {}]) {
            rpc.mockResolvedValue({ ok: true, result });
            expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'error' });
        }
    });
    it('reports an older CLI capability as unsupported and a broken transport as an error', async () => {
        rpc.mockResolvedValue({ ok: false, error: { code: 'unsupported-capability', message: 'Unsupported capability: tool.machineMetrics' } });
        expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'unsupported' });
        rpc.mockRejectedValue(new Error('disconnected'));
        expect(await loadMachineMetrics(scope, 'host-a')).toEqual({ status: 'error' });
    });
});

describe('released-CLI host metrics through the existing machine shell RPC', () => {
    const olderCli = { ok: false, error: { code: 'unknown-capability', message: 'Unknown capability: tool.machineMetrics' } };
    const respondAsOlderCli = (bash: (payload: Record<string, unknown>) => unknown) => {
        rpc.mockImplementation(async ({ method, payload }: { method: string; payload: Record<string, unknown> }) =>
            method === 'bash' ? bash(payload) : olderCli);
    };
    const bashCalls = () => rpc.mock.calls.map(([call]) => call).filter((call) => call.method === 'bash');

    it('reads a Mac host with one fixed read-only argv command and interprets it like the CLI collector', async () => {
        respondAsOlderCli(() => ({ success: true, stdout: darwinShellMetricsStdout, stderr: '', exitCode: 0 }));
        const result = await loadMachineMetrics(scope, 'host-a', 'darwin');
        const [call] = bashCalls();
        expect(call).toMatchObject({ machineId: 'host-a', serverId: 'server-a', accountId: 'account-a', timeoutMs: 30_000 });
        expect(call.payload).toEqual({ argv: ['/bin/sh', '-c', expect.stringContaining('/usr/bin/top -l 2')], cwd: '/', timeout: 30_000 });
        expect(result).toMatchObject({ status: 'ready', source: 'shell' });
        if (result.status !== 'ready') throw new Error('expected a reading');
        const totalDisk = 1948455240 * 1024;
        expect(result.snapshot).toMatchObject({ version: 1, machineId: 'host-a', platform: 'darwin',
            cpu: { status: 'available', usagePercent: 100 - 51.71, sampleMs: 1000 },
            memory: { status: 'available', totalBytes: 51539607552, usedBytes: 51539607552 - 10792 * 16384 },
            storage: { status: 'available', totalBytes: totalDisk, usedBytes: 1818105828 * 1024, filesystemPath: '/Users/dev', volume: '/System/Volumes/Data' },
            load: { status: 'available', averages: [28.7, 21.45, 21.32] },
            gpu: { status: 'available', devices: [{ id: 'ioreg:4294968574', name: 'Apple M4 Pro', utilization: { status: 'available', usagePercent: 0 } }] } });
    });

    it('reads a Windows host through PowerShell, using CPU counter deltas and the shared GPU engine definition', async () => {
        respondAsOlderCli(() => ({ success: true, stdout: win32ShellMetricsStdout, stderr: '', exitCode: 0 }));
        const result = await loadMachineMetrics(scope, 'host-w', 'win32');
        expect(bashCalls()[0].payload).toEqual({ argv: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('Win32_PerfRawData_PerfOS_Processor')], cwd: '/', timeout: 30_000 });
        if (result.status !== 'ready') throw new Error('expected a reading');
        const idleDelta = 8930725019531 - 8930716015625;
        const timeDelta = 134386475726300541n - 134386475715910464n;
        expect(result.snapshot.cpu).toEqual({ status: 'available', usagePercent: expect.closeTo(100 * (1 - idleDelta / Number(timeDelta)), 6), sampleMs: Number(timeDelta) / 10_000 });
        expect(result.snapshot).toMatchObject({ platform: 'win32',
            memory: { status: 'available', totalBytes: 67053948 * 1024, usedBytes: (67053948 - 37470332) * 1024 },
            storage: { status: 'available', totalBytes: 1023195213824, usedBytes: 1023195213824 - 68069453824, filesystemPath: 'C:\\Users\\Admin', volume: 'C:\\' },
            load: { status: 'unavailable', reason: 'unsupported-platform' },
            // The captured host was idle; aggregation across engines is covered by the shared parser's own test.
            gpu: { status: 'available', devices: [{ id: expect.stringMatching(/_phys_0$/), utilization: { status: 'available', usagePercent: 0 } }] } });
    });

    it('reads a Linux host from /proc counters, df and the AMD and NVIDIA utilization interfaces', async () => {
        respondAsOlderCli(() => ({ success: true, stdout: linuxShellMetricsStdout, stderr: '', exitCode: 0 }));
        const result = await loadMachineMetrics(scope, 'host-l', 'linux');
        expect(bashCalls()[0].payload).toEqual({ argv: ['/bin/sh', '-c', expect.stringContaining('/proc/stat')], cwd: '/', timeout: 30_000 });
        if (result.status !== 'ready') throw new Error('expected a reading');
        expect(result.snapshot).toMatchObject({ platform: 'linux',
            cpu: { status: 'available', usagePercent: 30, sampleMs: 1000 },
            memory: { status: 'available', totalBytes: 16303452 * 1024, usedBytes: (16303452 - 9145672) * 1024 },
            storage: { status: 'available', totalBytes: 490617784 * 1024, usedBytes: 210545160 * 1024, filesystemPath: '/home/dev', volume: '/' },
            load: { status: 'available', averages: [0.52, 0.58, 0.59] },
            gpu: { status: 'available', devices: [
                { id: 'card1', utilization: { status: 'available', usagePercent: 12 } },
                { id: 'GPU-5a2c', name: 'NVIDIA GeForce RTX 4090', utilization: { status: 'available', usagePercent: 37 } },
            ] } });
    });

    it('falls back to MemFree like os.freemem() on a Linux kernel without MemAvailable', async () => {
        respondAsOlderCli(() => ({ success: true, stdout: wslLinuxShellMetricsStdout, stderr: '', exitCode: 0 }));
        const result = await loadMachineMetrics(scope, 'host-wsl', 'linux');
        if (result.status !== 'ready') throw new Error('expected a reading');
        expect(result.snapshot).toMatchObject({
            memory: { status: 'available', totalBytes: 67053948 * 1024, usedBytes: (67053948 - 37430252) * 1024 },
            cpu: { status: 'available', usagePercent: expect.closeTo(100 * (134 + 63 + 5) / (134 + 63 + 1422 + 5), 6) },
            storage: { status: 'available', volume: '/', filesystemPath: '/root' },
            gpu: { status: 'unavailable', reason: 'no-supported-gpu' },
        });
    });

    it('keeps an older CLI unsupported when its shell cannot answer, and never shells out for an unknown platform', async () => {
        for (const bash of [() => ({ success: false, stdout: '', stderr: 'denied', exitCode: 1 }), () => { throw new Error('no bash handler'); },
            () => ({ success: true, stdout: 'garbage', stderr: '', exitCode: 0 })]) {
            respondAsOlderCli(bash);
            expect(await loadMachineMetrics(scope, 'host-a', 'darwin')).toEqual({ status: 'unsupported' });
        }
        rpc.mockReset();
        respondAsOlderCli(() => ({ success: true, stdout: darwinShellMetricsStdout, stderr: '', exitCode: 0 }));
        for (const platform of [undefined, null, 'freebsd']) expect(await loadMachineMetrics(scope, 'host-a', platform)).toEqual({ status: 'unsupported' });
        expect(bashCalls()).toHaveLength(0);
    });

    it('marks capability readings with their source and does not shell out for a metrics-capable CLI', async () => {
        rpc.mockResolvedValue({ ok: true, result: reading() });
        expect(await loadMachineMetrics(scope, 'host-a', 'linux')).toMatchObject({ status: 'ready', source: 'capability' });
        expect(bashCalls()).toHaveLength(0);
    });
});
