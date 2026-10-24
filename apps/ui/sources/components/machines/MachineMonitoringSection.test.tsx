import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMachineFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerId } from '@/sync/domains/server/serverProfiles';
import { MachineMonitoringSection } from './MachineMonitoringSection';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: rpc }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
afterEach(() => { standardCleanup(); vi.useRealTimers(); rpc.mockReset(); });

describe('machine monitoring real store and rendered leaf', () => {
    it('renders correct per-host attribution and unavailable values, retains readings and isolates telemetry from session storage', async () => {
        const previous = storage.getState();
        const serverId = getActiveServerId();
        const now = Date.now();
        const machines = [createMachineFixture({ id: 'render-host-a', activeAt: now, metadata: { host: 'host-a', displayName: 'My chosen host name', platform: 'darwin', happyCliVersion: 'fixture', happyHomeDir: '/fixture', homeDir: '/fixture' } }),
            createMachineFixture({ id: 'render-host-b', activeAt: now })];
        storage.setState({ isDataReady: true, profileScope: { serverId, accountId: 'render-metrics-account' },
            machines: Object.fromEntries(machines.map((machine) => [machine.id, machine])), machineListByServerId: { [serverId]: machines } });
        const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
        let resolveFirst!: (value: unknown) => void;
        rpc.mockImplementation(({ machineId }: { machineId: string }) => machineId === machines[0].id ? new Promise((resolve) => { resolveFirst = resolve; })
            : Promise.resolve({ ok: false, error: { code: 'unsupported-capability', message: 'unsupported' } }));
        const commits: number[] = [];
        let storageNotifications = 0;
        const detach = storage.subscribe(() => storageNotifications++);
        let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
        try {
            screen = await renderScreen(<React.Profiler id="machine-monitoring" onRender={(_id, _phase, duration) => { commits.push(duration); }}><MachineMonitoringSection /></React.Profiler>);
            await act(async () => resolveFirst({ ok: true, result: { version: 1, machineId: machines[0].id, platform: 'darwin', sampledAt: Date.now(), collectionMs: 1000,
                cpu: { status: 'available', usagePercent: 42, sampleMs: 1000 }, memory: absent, storage: absent, gpu: absent, load: absent } }));
            const row = screen.findByTestId('machine-monitoring-render-host-a-details')!;
            expect(row.props.accessibilityLabel).toContain('My chosen host name');
            expect(row.props.accessibilityLabel).toContain('CPU 42%');
            expect(row.props.accessibilityLabel).toContain('GPU —');
            expect(row.props.accessibilityLabel).not.toContain('GPU 0%');
            expect(storageNotifications).toBe(0);
            await screen.pressByTestIdAsync('machine-monitoring-toggle');
            expect(screen.findByTestId('machine-monitoring-render-host-a')).toBeNull();
            await screen.pressByTestIdAsync('machine-monitoring-toggle');
            expect(screen.findByTestId('machine-monitoring-render-host-a-details')!.props.accessibilityLabel).toContain('CPU 42%');
            expect(rpc.mock.calls.filter(([request]) => request.machineId === machines[0].id)).toHaveLength(1);
            console.info('[OH59 render measurement]', JSON.stringify({ machines: 2, commits: commits.length, totalRenderMs: commits.reduce((sum, duration) => sum + duration, 0), storageNotifications }));
        } finally { await screen?.unmount(); detach(); storage.setState(previous, true); }
    });
});
