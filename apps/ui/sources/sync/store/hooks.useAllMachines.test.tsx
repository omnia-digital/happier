import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { createMachineFixture, createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';

import { useAllMachines, useFirstVisibleMachineId, useLaunchSelectionMachines, useMachineCliDetectionTarget, useMachineDisplayById, useMachineListByServerId, useSessionChatFooterState, useSessionForkSupportSource } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

afterEach(() => {
    standardCleanup();
});

describe('useAllMachines', () => {
    it('presents foreign sessions from their Home even when active machine and session ids collide', async () => {
        const { buildSessionListReachabilityModels, createSessionListReachabilityModelsCache } = await import('@/components/sessions/shell/sessionListReachabilityModels');
        const { projectSessionListMachineView } = await import('@/components/sessions/shell/view-state/projectSessionListMachineView');
        const { useSessionWorkspacePresentation } = await import('@/components/sessions/model/useSessionWorkspacePresentation');
        const { useSessionMachineDisplayLists } = await import('@/sync/store/hooks');
        const previousState = storage.getState();
        const machine = createMachineFixture();
        const activeMachine = createMachineFixture({ id: 'shared-machine', replacedByMachineId: 'a-successor' });
        const aSuccessor = createMachineFixture({ id: 'a-successor', metadata: { ...machine.metadata!, displayName: 'A machine', homeDir: '/a' } });
        const bOld = createMachineFixture({ id: 'shared-machine', replacedByMachineId: 'b-successor', revokedAt: 1 });
        const bSuccessor = createMachineFixture({ id: 'b-successor', metadata: { ...machine.metadata!, displayName: 'B machine', homeDir: '/b' } });
        const bOnly = createMachineFixture({ id: 'b-only', metadata: { ...machine.metadata!, displayName: 'B only', homeDir: '/b' } });
        const session = createSessionFixture({ id: 'shared-session', metadata: { ...createSessionFixture().metadata!, machineId: 'shared-machine', path: '/b/repo', homeDir: '/b' } });
        const items = [{ type: 'session' as const, serverId: 'home-b', session }];
        const machinesById = { [activeMachine.id]: activeMachine, [aSuccessor.id]: aSuccessor };
        const cache = createSessionListReachabilityModelsCache();
        try {
            storage.setState({
                profileScope: { serverId: 'home-a', accountId: 'account-a' },
                machines: machinesById,
                machineDisplayById: machinesById,
                machineListByServerId: { 'home-b': [bOld, bSuccessor, bOnly] },
                sessions: { [session.id]: createSessionFixture({ id: session.id, metadata: { ...session.metadata!, machineId: 'a-successor', path: '/a/wrong' } }) },
            });
            const input = { items, machinesById, workspaceLabelsV1: {}, cache };
            let headerRenders = 0;
            const headerHook = await renderHook(() => {
                headerRenders += 1;
                return useSessionWorkspacePresentation({ serverId: 'home-b', sessionId: session.id, metadata: session.metadata });
            });
            const listsHook = await renderHook(() => useSessionMachineDisplayLists());
            expect(headerHook.getCurrent()).toMatchObject({ machineId: 'b-successor', machineLabel: 'B machine', displayPath: '~/repo' });
            const settledHeaderRenders = headerRenders;
            const firstLists = listsHook.getCurrent();
            const first = buildSessionListReachabilityModels(input);
            expect(first.reachableSessionDisplayByKey.get('home-b:shared-session')).toMatchObject({ machineId: 'b-successor', machineLabel: 'B machine', workspaceSubtitle: 'repo' });
            const header = projectSessionListMachineView(items, machinesById).find(item => item.type === 'header' && item.headerKind === 'machine');
            expect(header).toMatchObject({ title: 'B machine', machine: { id: 'b-successor' } });
            const renamedActiveMachines = { ...machinesById, 'a-successor': { ...aSuccessor, metadata: { ...aSuccessor.metadata!, displayName: 'A renamed' } } };
            await act(async () => {
                storage.setState({ machines: renamedActiveMachines, machineDisplayById: renamedActiveMachines,
                    machineListByServerId: { 'home-b': [bOld, { ...bSuccessor, activeAt: bSuccessor.activeAt + 1000 }, bOnly] },
                });
            });
            expect(headerRenders).toBe(settledHeaderRenders);
            expect(listsHook.getCurrent()).toBe(firstLists);
            expect(buildSessionListReachabilityModels({ ...input, machinesById: renamedActiveMachines })).toBe(first);
            for (const [machineId, expectedLabel] of [['b-only', 'B only'], ['unavailable', 'unavailable']]) {
                const result = buildSessionListReachabilityModels({ ...input, cache: undefined, items: [{ ...items[0], session: { ...session, metadata: { ...session.metadata!, machineId } } }] });
                expect(result.reachableSessionDisplayByKey.get('home-b:shared-session')).toMatchObject({ machineId, machineLabel: expectedLabel, workspaceSubtitle: 'repo' });
            }
            await act(async () => {
                storage.setState({ machineListByServerId: { 'home-b': [bOld, { ...bSuccessor, metadata: { ...bSuccessor.metadata!, displayName: 'B renamed' } }, bOnly] } });
            });
            expect(headerHook.getCurrent()?.machineLabel).toBe('B renamed');
            expect(buildSessionListReachabilityModels(input).reachableSessionDisplayByKey.get('home-b:shared-session')?.machineLabel).toBe('B renamed');
            await headerHook.unmount();
            await listsHook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
    it('tracks the first visible machine id only while demanded', async () => {
        const previousState = storage.getState();
        const activeServerId = String(getActiveServerSnapshot().serverId ?? '').trim();
        const firstMachine = {
            id: 'm-first',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: { host: 'first', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
            metadataVersion: 1,
            daemonState: null,
            daemonStateVersion: 0,
        };
        const secondMachine = {
            ...firstMachine,
            id: 'm-second',
            createdAt: 2,
            updatedAt: 2,
            activeAt: 2,
            metadata: { ...firstMachine.metadata, host: 'second' },
        };

        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    [firstMachine.id]: firstMachine,
                    [secondMachine.id]: secondMachine,
                },
                machineListByServerId: activeServerId
                    ? { [activeServerId]: [firstMachine, secondMachine] }
                    : {},
            }));

            let renderCount = 0;
            const hook = await renderHook(
                (enabled: boolean) => {
                    renderCount += 1;
                    return useFirstVisibleMachineId(enabled);
                },
                {
                    initialProps: true,
                    flushOptions: { cycles: 1, turns: 4 },
                },
            );
            expect(hook.getCurrent()).toBe('m-second');
            const settledRenderCount = renderCount;

            await act(async () => {
                const refreshedSecondMachine = {
                    ...secondMachine,
                    updatedAt: 3,
                    activeAt: 3,
                };
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        [firstMachine.id]: firstMachine,
                        [refreshedSecondMachine.id]: refreshedSecondMachine,
                    },
                    machineListByServerId: activeServerId
                        ? { [activeServerId]: [firstMachine, refreshedSecondMachine] }
                        : {},
                }));
            });
            expect(renderCount).toBe(settledRenderCount);

            await act(async () => {
                const promotedMachine = {
                    ...firstMachine,
                    createdAt: 4,
                    updatedAt: 4,
                    activeAt: 4,
                };
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        [promotedMachine.id]: promotedMachine,
                        [secondMachine.id]: secondMachine,
                    },
                    machineListByServerId: activeServerId
                        ? { [activeServerId]: [promotedMachine, secondMachine] }
                        : {},
                }));
            });
            expect(hook.getCurrent()).toBe('m-first');

            await hook.rerender(false);
            expect(hook.getCurrent()).toBeNull();
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('returns cached machines even when bootstrap is not fully ready (avoids empty flicker)', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: false,
                machines: {
                    'm-cached': {
                        id: 'm-cached',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata: { host: 'cached', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                },
            }));

            const hook = await renderHook(() => useAllMachines(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent().map((machine) => machine.id)).toEqual(['m-cached']);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('refreshes launch-selection machines when heartbeat freshness changes', async () => {
        const previousState = storage.getState();
        try {
            const activeAt = Date.now();
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-online': {
                        id: 'm-online',
                        seq: 1,
                        createdAt: activeAt,
                        updatedAt: activeAt,
                        active: true,
                        activeAt,
                        metadata: { host: 'online', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                        revokedAt: null,
                    },
                },
            }));

            const hook = await renderHook(() => useLaunchSelectionMachines(), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstMachines = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        ...state.machines,
                        'm-online': {
                            ...state.machines['m-online']!,
                            updatedAt: activeAt + 1000,
                            activeAt: activeAt + 1000,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).not.toBe(firstMachines);
            expect(hook.getCurrent()[0]?.activeAt).toBe(activeAt + 1000);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps CLI detection machine target stable when heartbeat timestamps do not change online status', async () => {
        const previousState = storage.getState();
        try {
            const activeAt = Date.now();
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-online': {
                        id: 'm-online',
                        seq: 1,
                        createdAt: activeAt,
                        updatedAt: activeAt,
                        active: true,
                        activeAt,
                        metadata: { host: 'online', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 7,
                        revokedAt: null,
                    },
                },
            }));

            const hook = await renderHook(() => useMachineCliDetectionTarget('m-online'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstTarget = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        ...state.machines,
                        'm-online': {
                            ...state.machines['m-online']!,
                            updatedAt: activeAt + 1000,
                            activeAt: activeAt + 1000,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(firstTarget);
            expect(hook.getCurrent()).toEqual({
                daemonStateVersion: 7,
                isOnline: true,
            });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps machine display records stable when full machine heartbeat fields change', async () => {
        const previousState = storage.getState();
        try {
            const activeAt = Date.now();
            const displayRecord = {
                id: 'm-online',
                updatedAt: activeAt,
                active: true,
                activeAt,
                revokedAt: null,
                metadataVersion: 1,
                metadata: {
                    displayName: 'Online Machine',
                    host: 'online',
                    homeDir: '/home',
                },
            };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machineDisplayById: {
                    'm-online': displayRecord,
                },
                machines: {
                    'm-online': {
                        id: 'm-online',
                        seq: 1,
                        createdAt: activeAt,
                        updatedAt: activeAt,
                        active: true,
                        activeAt,
                        metadata: { displayName: 'Online Machine', host: 'online', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 7,
                        revokedAt: null,
                    },
                },
            }));

            const hook = await renderHook(() => useMachineDisplayById(), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstById = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    machines: {
                        ...state.machines,
                        'm-online': {
                            ...state.machines['m-online']!,
                            seq: 2,
                            updatedAt: activeAt + 1000,
                            activeAt: activeAt + 1000,
                            daemonStateVersion: 8,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(firstById);
            expect(hook.getCurrent()['m-online']).toBe(displayRecord);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps transcript fork support source stable when only session activity fields change', async () => {
        const previousState = storage.getState();
        try {
            const metadata = { path: '/repo', host: 'mac', codexSessionId: 'codex-session' };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: {
                    ...state.sessions,
                    's-active': {
                        id: 's-active',
                        seq: 10,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata,
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 1,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    },
                },
            }));

            const hook = await renderHook(() => useSessionForkSupportSource('s-active'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstSource = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        's-active': {
                            ...state.sessions['s-active']!,
                            seq: 11,
                            updatedAt: 3000,
                            activeAt: 3000,
                            thinkingAt: 3000,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(firstSource);
            expect(hook.getCurrent()).toEqual({ metadata });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps transcript fork support source stable when only metadata freshness fields change', async () => {
        const previousState = storage.getState();
        try {
            const metadata = {
                path: '/repo',
                host: 'mac',
                codexSessionId: 'codex-session',
                sessionModesV1: {
                    v: 1 as const,
                    provider: 'codex',
                    updatedAt: 100,
                    currentModeId: 'default',
                    availableModes: [{ id: 'default', name: 'Default' }],
                },
                summary: { text: 'Summary', updatedAt: 100 },
            };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: {
                    ...state.sessions,
                    's-active': {
                        id: 's-active',
                        seq: 10,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata,
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 1,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    },
                },
            }));

            const hook = await renderHook(() => useSessionForkSupportSource('s-active'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstSource = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        's-active': {
                            ...state.sessions['s-active']!,
                            metadataVersion: 2,
                            metadata: {
                                ...metadata,
                                sessionModesV1: {
                                    ...metadata.sessionModesV1,
                                    updatedAt: 200,
                                },
                                summary: { text: 'Summary', updatedAt: 200 },
                            },
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(firstSource);
            expect(hook.getCurrent()).toEqual({ metadata });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('refreshes transcript fork support source when permission mode timestamp changes', async () => {
        const previousState = storage.getState();
        try {
            const metadata = {
                path: '/repo',
                host: 'mac',
                codexSessionId: 'codex-session',
                permissionMode: 'yolo' as const,
                permissionModeUpdatedAt: 100,
            };
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: {
                    ...state.sessions,
                    's-active': {
                        id: 's-active',
                        seq: 10,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata,
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 1,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    },
                },
            }));

            const hook = await renderHook(() => useSessionForkSupportSource('s-active'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstSource = hook.getCurrent();

            const refreshedMetadata = {
                ...metadata,
                permissionModeUpdatedAt: 200,
            };
            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        's-active': {
                            ...state.sessions['s-active']!,
                            metadataVersion: 2,
                            metadata: refreshedMetadata,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).not.toBe(firstSource);
            expect(hook.getCurrent()).toEqual({ metadata: refreshedMetadata });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps chat footer state stable when only session activity fields change', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                sessions: {
                    ...state.sessions,
                    's-active': {
                        id: 's-active',
                        seq: 10,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata: null,
                        metadataVersion: 1,
                        agentState: {
                            controlledByUser: false,
                            capabilities: {
                                permissionsInUiWhileLocal: true,
                            },
                            localControl: {
                                attached: true,
                                topology: 'shared',
                                remoteWritable: true,
                                canAttach: false,
                                canDetach: true,
                            },
                        },
                        agentStateVersion: 1,
                        thinking: false,
                        thinkingAt: 0,
                        presence: 'online',
                    },
                },
            }));

            const hook = await renderHook(() => useSessionChatFooterState('s-active'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstState = hook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        's-active': {
                            ...state.sessions['s-active']!,
                            seq: 11,
                            updatedAt: 3000,
                            activeAt: 3000,
                            thinkingAt: 3000,
                        },
                    },
                }));
            });

            expect(hook.getCurrent()).toBe(firstState);
            expect(hook.getCurrent()).toEqual({
                controlledByUser: false,
                localControl: {
                    attached: true,
                    topology: 'shared',
                    remoteWritable: true,
                    canAttach: false,
                    canDetach: true,
                },
                permissionsInUiWhileLocal: true,
            });

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it.each(['shared', 'exclusive'] as const)('retires and restores %s footer control through the real store', async (topology) => {
        const previousState = storage.getState();
        const session = createSessionFixture({
            id: 's-control-lifecycle', active: true,
            agentState: { controlledByUser: topology === 'exclusive', ...(topology === 'shared' ? {
                localControl: { attached: true, topology, remoteWritable: true, canDetach: true },
            } : {}) },
        });
        try {
            storage.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }));
            const hook = await renderHook(() => useSessionChatFooterState(session.id), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const attached = hook.getCurrent();
            expect(attached?.localControl?.attached).toBe(true);
            expect(attached?.controlledByUser).toBe(topology === 'exclusive');

            await act(async () => {
                storage.setState((state) => ({ sessions: { ...state.sessions, [session.id]: { ...session, active: false } } }));
            });
            expect(hook.getCurrent()).toMatchObject({ controlledByUser: false, localControl: null });

            await act(async () => {
                storage.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }));
            });
            expect(hook.getCurrent()).toEqual(attached);

            await act(async () => {
                storage.setState((state) => ({ sessions: { ...state.sessions, [session.id]: {
                    ...session, metadata: { ...session.metadata!, terminal: { mode: 'herdr',
                        controlServiceabilityV1: { v: 1, attachmentId: 'retired-host', observedAt: 20,
                            state: 'unknown', retired: true },
                    } },
                } } }));
            });
            expect(hook.getCurrent()).toMatchObject({ controlledByUser: false, localControl: null });
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('includes offline machines and sorts online machines first', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-online': {
                        id: 'm-online',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata: { host: 'online', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                    'm-offline': {
                        id: 'm-offline',
                        seq: 1,
                        createdAt: 2000,
                        updatedAt: 2000,
                        active: false,
                        activeAt: 2000,
                        metadata: { host: 'offline', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                    },
                },
            }));

            const hook = await renderHook(() => useAllMachines(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent().map((machine) => machine.id)).toEqual(['m-online', 'm-offline']);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('excludes revoked machines from visible machine lists', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-online': {
                        id: 'm-online',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata: { host: 'online', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                        revokedAt: null,
                    },
                    'm-revoked': {
                        id: 'm-revoked',
                        seq: 1,
                        createdAt: 1200,
                        updatedAt: 1200,
                        active: false,
                        activeAt: 1200,
                        metadata: { host: 'revoked', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                        revokedAt: 1700000000000,
                    },
                },
                machineListByServerId: {
                    'server-a': [
                        { id: 'm-online', active: true, activeAt: 1000, createdAt: 1000, updatedAt: 1000, metadata: { host: 'online' }, revokedAt: null } as any,
                        { id: 'm-revoked', active: false, activeAt: 1200, createdAt: 1200, updatedAt: 1200, metadata: { host: 'revoked' }, revokedAt: 1700000000000 } as any,
                    ],
                },
            }));

            const allMachinesHook = await renderHook(() => useAllMachines(), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const byServerHook = await renderHook(() => useMachineListByServerId(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(allMachinesHook.getCurrent().map((machine) => machine.id)).toEqual(['m-online']);
            expect((byServerHook.getCurrent()['server-a'] ?? []).map((machine) => machine.id)).toEqual(['m-online']);

            await allMachinesHook.unmount();
            await byServerHook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('prefers the active-server machine cache over global machine map entries', async () => {
        const previousState = storage.getState();
        try {
            const activeServerId = String(getActiveServerSnapshot().serverId ?? '').trim() || 'server-active';
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-active': {
                        id: 'm-active',
                        seq: 1,
                        createdAt: 1000,
                        updatedAt: 1000,
                        active: true,
                        activeAt: 1000,
                        metadata: { host: 'active', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                        revokedAt: null,
                    },
                    'm-stale': {
                        id: 'm-stale',
                        seq: 1,
                        createdAt: 900,
                        updatedAt: 900,
                        active: true,
                        activeAt: 900,
                        metadata: { host: 'stale', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                        metadataVersion: 1,
                        daemonState: null,
                        daemonStateVersion: 0,
                        revokedAt: null,
                    },
                },
                machineListByServerId: {
                    [activeServerId]: [
                        {
                            id: 'm-active',
                            seq: 1,
                            createdAt: 1000,
                            updatedAt: 1000,
                            active: true,
                            activeAt: 1000,
                            metadata: { host: 'active', platform: 'darwin', happyCliVersion: '1', happyHomeDir: '.happy', homeDir: '/home' },
                            metadataVersion: 1,
                            daemonState: null,
                            daemonStateVersion: 0,
                            revokedAt: null,
                        } as any,
                    ],
                },
            }));

            const hook = await renderHook(() => useAllMachines(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent().map((machine) => machine.id)).toEqual(['m-active']);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
