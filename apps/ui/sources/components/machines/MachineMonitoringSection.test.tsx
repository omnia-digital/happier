import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMachineFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerId } from '@/sync/domains/server/serverProfiles';
import { MachineMonitoringSection } from './MachineMonitoringSection';

const rpc = vi.hoisted(() => vi.fn());
// The transport is stubbed for rendering; real metrics parsing/store/UI remain in scope.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => {
    const { createServerScopedMachineRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return createServerScopedMachineRpcModuleMock({ importOriginal, overrides: { machineRpcWithServerScope: rpc } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
afterEach(() => { standardCleanup(); vi.useRealTimers(); rpc.mockReset(); });

describe('machine monitoring real store and rendered leaf', () => {
    it('keeps metric availability in the compact summary and reveals presence and full readings on expansion', async () => {
        const previous = storage.getState();
        const serverId = getActiveServerId();
        const machine = createMachineFixture({ id: 'compact-unsupported-host', activeAt: Date.now() });
        storage.setState({ isDataReady: true, profileScope: { serverId, accountId: 'compact-metrics-account' },
            machines: { [machine.id]: machine }, machineListByServerId: { [serverId]: [machine] } });
        rpc.mockResolvedValue({ ok: false, error: { code: 'unsupported-capability', message: 'unsupported' } });
        let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
        try {
            screen = await renderScreen(<MachineMonitoringSection />);
            const buttonId = `machine-monitoring-${machine.id}-details`;
            expect(screen.findByTestId(buttonId)!.props.accessibilityState.expanded).toBe(false);
            expect(screen.getTextContent()).not.toMatch(/\bOnline\b/i);
            expect(screen.getTextContent()).toContain('does not support host metrics');
            expect(screen.findByTestId(buttonId)!.props.accessibilityLabel).toMatch(/\bonline\b/i);
            expect(screen.getTextContent()).not.toContain('Storage capacity used, not I/O');
            await screen.pressByTestIdAsync(buttonId);
            expect(screen.findByTestId(buttonId)!.props.accessibilityState.expanded).toBe(true);
            expect(screen.getTextContent()).toContain('Storage capacity used, not I/O');
            expect(screen.getTextContent()).toMatch(/\bonline\b/i);
            for (const metric of ['CPU', 'MEM', 'GPU', 'Storage used', 'LA 1/5/15m']) {
                expect(screen.findByTestId(buttonId)!.props.accessibilityLabel).toContain(`${metric} —`);
            }
            await screen.pressByTestIdAsync(buttonId);
            expect(screen.findByTestId(buttonId)!.props.accessibilityState.expanded).toBe(false);
            expect(screen.getTextContent()).not.toContain('Storage capacity used, not I/O');
        } finally { await screen?.unmount(); storage.setState(previous, true); }
    });
    it('renders each available GPU percentage and expands its actual device identity, including measured zero', async () => {
        const previous = storage.getState();
        const serverId = getActiveServerId();
        const machine = createMachineFixture({ id: 'render-multi-gpu-host', activeAt: Date.now() });
        storage.setState({ isDataReady: true, profileScope: { serverId, accountId: 'render-multi-gpu-account' },
            machines: { [machine.id]: machine }, machineListByServerId: { [serverId]: [machine] } });
        const absent = { status: 'unavailable', reason: 'no-supported-gpu' };
        rpc.mockResolvedValue({ ok: true, result: {
            version: 1, machineId: machine.id, platform: 'darwin', sampledAt: Date.now(), collectionMs: 1000,
            cpu: absent, memory: absent, storage: absent, load: absent,
            gpu: { status: 'available', devices: [
                { id: 'ioreg:4294969373', name: 'Apple M5 Pro', utilization: { status: 'available', usagePercent: 0 } },
                { id: 'ioreg:9007199254740993', name: 'Second GPU', utilization: { status: 'available', usagePercent: 47 } },
            ] },
        } });
        let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
        try {
            screen = await renderScreen(<MachineMonitoringSection />);
            expect(screen.findByTestId(`machine-monitoring-${machine.id}-details`)!.props.accessibilityLabel).toContain('GPU 0%/47%');
            await screen.pressByTestIdAsync(`machine-monitoring-${machine.id}-details`);
            expect(screen.getTextContent()).toContain('Apple M5 Pro · ioreg:4294969373 · 0%');
            expect(screen.getTextContent()).toContain('Second GPU · ioreg:9007199254740993 · 47%');
        } finally { await screen?.unmount(); storage.setState(previous, true); }
    });

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
