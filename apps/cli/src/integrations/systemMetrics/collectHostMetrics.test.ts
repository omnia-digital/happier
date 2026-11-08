import { describe, expect, it } from 'vitest';
import type { CpuInfo } from 'node:os';
import { collectHostMetrics, cpuUsageFromSamples } from './collectHostMetrics';

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
    it('honors cancellation before measuring or spawning platform tools', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(collectHostMetrics('machine', controller.signal)).rejects.toThrow();
    });
});
