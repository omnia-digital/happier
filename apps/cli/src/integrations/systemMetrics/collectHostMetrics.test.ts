import { describe, expect, it } from 'vitest';
import type { CpuInfo } from 'node:os';
import { capacityUsage, collectHostMetrics, cpuUsageFromSamples, parseDarwinGpuUtilization, parseNvidiaGpuUtilization, parseWindowsGpuEngineUtilization } from './collectHostMetrics';

const cpu = (user: number, idle: number): CpuInfo => ({ model: 'fixture', speed: 1, times: { user, idle, nice: 0, sys: 0, irq: 0 } });
describe('host resource measurement definitions', () => {
    it('measures total busy CPU time across all logical cores', () => {
        expect(cpuUsageFromSamples([cpu(10, 10), cpu(10, 10)], [cpu(110, 10), cpu(10, 310)], 1000))
            .toEqual({ status: 'available', usagePercent: 25, sampleMs: 1000 });
    });
    it('does not turn missing, reset or unchanged CPU counters into zero usage', () => {
        for (const [before, after] of [[[], []], [[cpu(10, 10)], [cpu(10, 10)]], [[cpu(10, 10)], [cpu(0, 0)]]]) {
            expect(cpuUsageFromSamples(before, after, 1000)).toMatchObject({ status: 'unavailable' });
        }
    });
    it('uses nonfree capacity and rejects absent or inconsistent capacity', () => {
        expect(capacityUsage(100, 40)).toEqual({ status: 'available', totalBytes: 100, usedBytes: 60, usagePercent: 60 });
        for (const [total, free] of [[0, 0], [100, 101], [NaN, 2]]) expect(capacityUsage(total, free)).toMatchObject({ status: 'unavailable' });
    });
    it('attributes every NVIDIA device and keeps unsupported utilization unavailable', () => {
        expect(parseNvidiaGpuUtilization('GPU-a, NVIDIA One, 0\nGPU-b, NVIDIA Two, [N/A]')).toEqual([
            { id: 'GPU-a', name: 'NVIDIA One', utilization: { status: 'available', usagePercent: 0 } },
            { id: 'GPU-b', name: 'NVIDIA Two', utilization: { status: 'unavailable', reason: 'invalid-data' } },
        ]);
    });
    it('attributes Mac accelerators by registry identity and reads only explicit device percentages, including zero', () => {
        const first = { IORegistryEntryID: '4294969373', IORegistryEntryName: 'AGXAcceleratorG17X', model: 'Apple M5 Pro',
            PerformanceStatistics: { 'Device Utilization %': 0, 'Renderer Utilization %': 70, 'Tiler Utilization %': 80 } };
        expect(parseDarwinGpuUtilization([first, first, {
            IORegistryEntryID: '18446744073709551614', IORegistryEntryName: 'SecondAccelerator', model: 'Second GPU',
            PerformanceStatistics: { 'Device Utilization %': 32.5 },
        }])).toEqual([
            { id: 'ioreg:4294969373', name: 'Apple M5 Pro', utilization: { status: 'available', usagePercent: 0 } },
            { id: 'ioreg:18446744073709551614', name: 'Second GPU', utilization: { status: 'available', usagePercent: 32.5 } },
        ]);
    });
    it('keeps absent, unsupported, malformed and conflicting Mac GPU readings unavailable', () => {
        const entry = { IORegistryEntryID: '42', IORegistryEntryName: 'AGXAccelerator' };
        for (const PerformanceStatistics of [undefined, {}, { 'GPU Core Utilization': 9000 }]) {
            expect(parseDarwinGpuUtilization([{ ...entry, PerformanceStatistics }])).toEqual([
                { id: 'ioreg:42', name: 'AGXAccelerator', utilization: { status: 'unavailable', reason: 'no-supported-gpu' } },
            ]);
        }
        for (const usage of [NaN, Infinity, -1, 101, null, '', '0', false]) {
            expect(parseDarwinGpuUtilization([{ ...entry, PerformanceStatistics: { 'Device Utilization %': usage } }])[0]?.utilization)
                .toEqual({ status: 'unavailable', reason: 'invalid-data' });
        }
        expect(parseDarwinGpuUtilization([1, null, {}, { ...entry, IORegistryEntryID: 'not-an-id' }])).toEqual([]);
        expect(parseDarwinGpuUtilization([0, 20].map((usage) => ({ ...entry, PerformanceStatistics: { 'Device Utilization %': usage } })))[0]?.utilization)
            .toEqual({ status: 'unavailable', reason: 'invalid-data' });
    });
    it('aggregates WDDM processes within each engine, then takes the busiest engine for each physical GPU', () => {
        const row = (pid: number, phys: number, engine: number, usage: number) => ({ Name: `pid_${pid}_luid_0x00000000_0x00001234_phys_${phys}_eng_${engine}_engtype_3D`, UtilizationPercentage: usage });
        const devices = parseWindowsGpuEngineUtilization(JSON.stringify([row(1, 0, 0, 20), row(2, 0, 0, 30), row(1, 0, 1, 10), row(1, 1, 0, 70)]));
        expect(devices.map((device) => ({ id: device.id, utilization: device.utilization }))).toEqual([
            { id: 'luid_0x00000000_0x00001234_phys_0', utilization: { status: 'available', usagePercent: 50 } },
            { id: 'luid_0x00000000_0x00001234_phys_1', utilization: { status: 'available', usagePercent: 70 } },
        ]);
        expect(parseWindowsGpuEngineUtilization('[]')).toEqual([]);
    });
    it('honors cancellation before measuring or spawning platform tools', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(collectHostMetrics('machine', controller.signal)).rejects.toThrow();
    });
});
