import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, ExecFileOptions } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutableShim } from '@/testkit/fs/executableShim';
import { createMachineMetricsCapability } from '@/capabilities/registry/toolMachineMetrics';
import { collectHostMetrics } from './collectHostMetrics';

const boundary = vi.hoisted(() => ({
    replacements: new Map<string, string>(),
    calls: [] as Array<{ file: string; options: ExecFileOptions; child: ChildProcess }>,
}));

// Replace only executable paths at the OS boundary. The real execFile, stdin pipe,
// AbortSignal, child cleanup, plutil parser and collector all execute normally.
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    const { promisify } = await import('node:util');
    const run = promisify(actual.execFile);
    const execFile = Object.assign(actual.execFile.bind(actual), {
        [promisify.custom]: (file: string, args: string[], options: ExecFileOptions) => {
            const replacement = boundary.replacements.get(file);
            const result = run(replacement ?? file, replacement ? [] : args, options);
            boundary.calls.push({ file, options, child: result.child });
            return result;
        },
    });
    return { ...actual, execFile };
});

// Sanitized IOAccelerator shape. Unrelated CFData deliberately makes whole-plist
// JSON conversion impossible; the real plutil extraction must preserve both GPUs.
// Its size also exercises cancellation with stdin still buffered, like the observed
// 102 KB registry response on the development Mac, rather than a tiny pipe write.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
<dict><key>IORegistryEntryID</key><integer>4294969373</integer>
<key>IORegistryEntryName</key><string>AGXAcceleratorG17X</string><key>model</key><string>Apple M5 Pro</string>
<key>UnrelatedDriverData</key><data>${'AQID'.repeat(30_000)}</data><key>PerformanceStatistics</key><dict>
<key>Device Utilization %</key><integer>0</integer><key>Renderer Utilization %</key><integer>90</integer>
</dict></dict>
<dict><key>IORegistryEntryID</key><integer>9007199254740993</integer>
<key>IORegistryEntryName</key><string>SecondAccelerator</string><key>model</key><string>Second GPU</string>
<key>PerformanceStatistics</key><dict><key>Device Utilization %</key><real>32.5</real></dict></dict>
</array></plist>`;

describe.skipIf(process.platform !== 'darwin')('Mac GPU OS query boundary', () => {
    let temp = '';
    const controllers: AbortController[] = [];
    beforeEach(async () => {
        temp = await mkdtemp(join(tmpdir(), 'oh59-mac-gpu-'));
        boundary.replacements.clear();
        boundary.calls.length = 0;
        const ioreg = await createExecutableShim({ baseDir: temp, dirPrefix: 'ioreg-', fileName: 'ioreg',
            contents: `#!/bin/sh\n/bin/cat <<'HAPPIER_GPU_FIXTURE'\n${plist}\nHAPPIER_GPU_FIXTURE\n` });
        boundary.replacements.set('/usr/sbin/ioreg', ioreg);
    });
    afterEach(async () => {
        for (const controller of controllers.splice(0)) controller.abort();
        for (const { child } of boundary.calls) {
            if (child.exitCode === null && child.signalCode === null) child.kill();
        }
        await rm(temp, { recursive: true, force: true });
    });

    it('uses real typed plist extraction, preserves device IDs, and shares the caller signal across every query', async () => {
        const controller = new AbortController(); controllers.push(controller);
        const result = await collectHostMetrics('fixture-host', controller.signal);
        expect(result.gpu).toEqual({ status: 'available', devices: [
            { id: 'ioreg:4294969373', name: 'Apple M5 Pro', utilization: { status: 'available', usagePercent: 0 } },
            { id: 'ioreg:9007199254740993', name: 'Second GPU', utilization: { status: 'available', usagePercent: 32.5 } },
        ] });
        expect(boundary.calls.some(({ file }) => file === '/usr/bin/plutil')).toBe(true);
        for (const { options } of boundary.calls) {
            expect(options.signal).toBe(controller.signal);
            expect(options.timeout).toBeUndefined();
        }
    });

    it.each(['/usr/sbin/ioreg', '/usr/bin/plutil'])('terminates an owned hanging %s child at the receiving collection deadline', async (file) => {
        const hanging = await createExecutableShim({ baseDir: temp, dirPrefix: 'hanging-', fileName: 'query',
            contents: '#!/bin/sh\nexec /bin/sleep 60\n' });
        boundary.replacements.set(file, hanging);
        const controller = new AbortController(); controllers.push(controller);
        const collection = createMachineMetricsCapability('receiver').invoke!({ method: 'snapshot', params: { timeoutMs: 1_500 }, signal: controller.signal });
        await expect.poll(() => boundary.calls.find((call) => call.file === file)?.child.pid).toBeTypeOf('number');
        const child = boundary.calls.find((call) => call.file === file)!.child;
        expect(await collection).toMatchObject({ ok: false, error: { code: 'collection-timeout' } });
        await expect.poll(() => {
            try { process.kill(child.pid!, 0); return false; } catch { return true; }
        }).toBe(true);
        const signal = boundary.calls[0].options.signal;
        expect(signal?.aborted).toBe(true);
        for (const call of boundary.calls) expect(call.options.signal).toBe(signal);
    });

    it('reports a failed registry query as unavailable instead of an invented zero', async () => {
        boundary.replacements.set('/usr/sbin/ioreg', await createExecutableShim({ baseDir: temp, dirPrefix: 'failed-', fileName: 'ioreg',
            contents: '#!/bin/sh\nexit 1\n' }));
        expect((await collectHostMetrics('fixture-host')).gpu).toEqual({ status: 'unavailable', reason: 'collection-failed' });
    });

    it('terminates a query that closes its input early and reports the failed write', async () => {
        boundary.replacements.set('/usr/bin/plutil', await createExecutableShim({ baseDir: temp, dirPrefix: 'closed-input-', fileName: 'plutil',
            contents: '#!/bin/sh\nexec 0<&-\nexec /bin/sleep 60\n' }));
        const controller = new AbortController(); controllers.push(controller);
        expect((await collectHostMetrics('fixture-host', controller.signal)).gpu).toEqual({ status: 'unavailable', reason: 'collection-failed' });
        const child = boundary.calls.find((call) => call.file === '/usr/bin/plutil')!.child;
        await expect.poll(() => {
            try { process.kill(child.pid!, 0); return false; } catch { return true; }
        }).toBe(true);
        expect(controller.signal.aborted).toBe(false);
    });
});
