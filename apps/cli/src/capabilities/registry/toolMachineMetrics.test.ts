import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { createExecutableShim } from '@/testkit/fs/executableShim';
import { createMachineMetricsCapability } from './toolMachineMetrics';

afterEach(() => { vi.unstubAllEnvs(); });

describe('host metrics receiving collection budget', () => {
    it.skipIf(process.platform === 'win32')('terminates an actual hanging native query at the supplied receiving budget', async () => {
        const temp = await mkdtemp(join(tmpdir(), 'oh59-metrics-budget-'));
        const pidPath = join(temp, 'query.pid');
        const executable = await createExecutableShim({ baseDir: temp, dirPrefix: 'gpu-', fileName: 'nvidia-smi',
            contents: `#!/bin/sh\nprintf '%s' "$$" > '${pidPath}'\nexec /bin/sleep 60\n` });
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        let childPid: number | undefined;
        let decisionTimer: ReturnType<typeof setTimeout> | undefined;
        const receivingBudgetMs = 1_500;
        let collection: ReturnType<NonNullable<ReturnType<typeof createMachineMetricsCapability>['invoke']>> | undefined;
        try {
            Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
            vi.stubEnv('PATH', `${dirname(executable)}${delimiter}${process.env.PATH ?? ''}`);
            const capability = createMachineMetricsCapability('receiver');
            collection = capability.invoke!({ method: 'snapshot', params: { timeoutMs: receivingBudgetMs } });
            await expect.poll(async () => {
                try { childPid = Number(await readFile(pidPath, 'utf8')); return childPid > 0; } catch { return false; }
            }).toBe(true);
            const response = await Promise.race([collection, new Promise((resolve) => { decisionTimer = setTimeout(() => resolve({ didNotSettle: true }), receivingBudgetMs + 500); })]);
            expect(response).toMatchObject({ ok: false, error: { code: 'collection-timeout' } });
            await expect.poll(() => {
                try { process.kill(childPid!, 0); return false; } catch { return true; }
            }).toBe(true);
            childPid = undefined;
        } finally {
            if (decisionTimer) clearTimeout(decisionTimer);
            if (childPid) { try { process.kill(childPid); } catch { /* fixture already terminated */ } }
            await collection?.catch(() => undefined);
            Object.defineProperty(process, 'platform', originalPlatform);
            await rm(temp, { recursive: true, force: true });
        }
    });

    it('allows a normal one-second observation within the canonical invoke budget', async () => {
        const result = await createMachineMetricsCapability('receiver').invoke!({ method: 'snapshot', params: { timeoutMs: 30_000 } });
        expect(result).toMatchObject({ ok: true, result: { machineId: 'receiver', cpu: { status: 'available', sampleMs: expect.any(Number) } } });
    });

    it('rejects absent, invalid and unbounded receiving budgets', async () => {
        for (const timeoutMs of [undefined, 0, -1, NaN, Infinity, 30_001]) {
            expect(await createMachineMetricsCapability('receiver').invoke!({ method: 'snapshot', params: { timeoutMs } }))
                .toMatchObject({ ok: false, error: { code: 'invalid-request' } });
        }
    });
});
