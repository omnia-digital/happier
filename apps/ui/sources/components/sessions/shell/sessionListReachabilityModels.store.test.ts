import { afterEach, describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { buildMachineDisplayRenderableFromMachine } from '@/sync/domains/machines/machineDisplayRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { storage } from '@/sync/domains/state/storageStore';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { getActiveServerId, setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { resolveSessionListSourceData } from '@/sync/domains/session/listing/sessionListPresentation';

import { buildSessionListReachabilityModels, createSessionListReachabilityModelsCache } from './sessionListReachabilityModels';

const initialState = storage.getState();
afterEach(() => storage.setState(initialState, true));

describe('session reachability display invalidation', () => {
    it('preserves a hydrated foreign session Home in the active list projection', () => {
        const previousActiveServerId = getActiveServerId();
        const homeA = upsertServerProfile({ serverUrl: 'https://list-hydration-a.example.test' });
        const homeB = upsertServerProfile({ serverUrl: 'https://list-hydration-b.example.test' });
        const machine = createMachineFixture();
        const machineA = { ...machine, id: 'shared-machine', replacedByMachineId: 'a-successor' };
        const successorA = { ...machine, id: 'a-successor', metadata: { ...machine.metadata!, displayName: 'A machine', homeDir: '/a' } };
        const machineB = { ...machine, id: 'shared-machine', replacedByMachineId: 'b-successor' };
        const successorB = { ...machine, id: 'b-successor', metadata: { ...machine.metadata!, displayName: 'B machine', homeDir: '/b' } };
        const session = createSessionFixture({ serverId: homeB.id, metadata: { ...createSessionFixture().metadata!, machineId: machineB.id, path: '/b/repo', homeDir: '/b' } });
        try {
            setActiveServerId(homeA.id, { scope: 'device' });
            storage.setState({ profileScope: { serverId: homeA.id, accountId: 'account-a' }, sessions: {}, sessionListRenderables: {}, sessionListViewData: null });
            storage.getState().applyMachines([machineA, successorA], true, { sourceServerId: homeA.id });
            storage.getState().applyMachines([machineB, successorB], true, { sourceServerId: homeB.id });
            storage.getState().applySessions([{ ...session, serverId: homeA.id, metadata: { ...session.metadata!, path: '/a/wrong', homeDir: '/a' } }]);
            storage.getState().applySessions([session]);
            const row = storage.getState().sessionListViewData?.find(item => item.type === 'session' && item.session.id === session.id);
            expect(storage.getState().sessions[session.id]?.serverId).toBe(homeB.id);
            expect(row?.serverId).toBe(homeB.id);
            expect(row?.type === 'session' ? row.workspace : null).toMatchObject({ serverId: homeB.id, machineId: 'b-successor', rootPath: '/b/repo' });
            const models = buildSessionListReachabilityModels({ items: storage.getState().sessionListViewData ?? [], machinesById: storage.getState().machineDisplayById, workspaceLabelsV1: {} });
            expect(models.reachableSessionDisplayByKey.get(`${homeB.id}:${session.id}`)).toMatchObject({ machineId: 'b-successor', machineLabel: 'B machine', workspaceSubtitle: 'repo' });
            expect(storage.getState().sessionListViewDataByServerId[homeA.id]?.find(item => item.type === 'session' && item.session.id === session.id)?.serverId).toBe(homeB.id);
            const selected = resolveSessionListSourceData({ enabled: true, activeServerId: homeA.id, activeData: storage.getState().sessionListViewData, byServerId: storage.getState().sessionListViewDataByServerId, selectedServerIds: [homeA.id] });
            expect(selected?.find(item => item.type === 'session' && item.session.id === session.id)).toBe(row);
            const initialList = storage.getState().sessionListViewData;
            storage.getState().applySessions([session]);
            expect(storage.getState().sessionListViewData).toBe(initialList);
            // Home identity alone is structural, including a same-id route moving back to A.
            storage.getState().applySessions([{ ...session, serverId: homeA.id }]);
            expect(storage.getState().sessionListViewData?.find(item => item.type === 'session' && item.session.id === session.id)?.serverId).toBe(homeA.id);
            storage.getState().applySessions([{ ...session, serverId: undefined }]);
            expect(storage.getState().sessionListViewData?.find(item => item.type === 'session' && item.session.id === session.id)?.serverId).toBe(homeA.id);
        } finally {
            setActiveServerId(previousActiveServerId, { scope: 'device' });
        }
    });
    it('retains the display projection on machine heartbeats but updates names, replacements and paths', () => {
        const session = createSessionFixture();
        const machine = createMachineFixture();
        machine.metadata = { ...machine.metadata!, displayName: 'Laptop' };
        storage.setState({
            profileScope: { serverId: 'server-a', accountId: 'account-a' },
            sessions: { [session.id]: session },
            machines: { [machine.id]: machine },
        });
        const cache = createSessionListReachabilityModelsCache();
        const items: SessionListViewItem[] = [{ type: 'session', serverId: 'server-a', session }];
        const workspaceLabelsV1 = {};
        const build = (machines: Machine[], rows = items) => buildSessionListReachabilityModels({
            cache, items: rows, workspaceLabelsV1,
            machinesById: Object.fromEntries(machines.map((value) => [value.id, buildMachineDisplayRenderableFromMachine(value)])),
        });
        const first = build([machine]);
        expect(first.reachableSessionDisplayByKey.get('server-a:session-1')).toMatchObject({
            machineId: 'machine-1', machineLabel: 'Laptop', workspaceSubtitle: 'project',
        });

        const heartbeat = { ...machine, activeAt: 2, updatedAt: 2 };
        storage.setState({ machines: { [heartbeat.id]: heartbeat } });
        // A refreshed source array must also reuse the existing per-row cache.
        expect(build([heartbeat], [...items])).toBe(first);

        const renamed = { ...heartbeat, metadata: { ...heartbeat.metadata!, displayName: 'Work laptop' } };
        storage.setState({ machines: { [renamed.id]: renamed } });
        expect(build([renamed]).reachableSessionDisplayByKey.get('server-a:session-1')?.machineLabel).toBe('Work laptop');

        const replacement = { ...renamed, id: 'machine-2', metadata: { ...renamed.metadata, displayName: 'Replacement' } };
        const predecessor = { ...renamed, replacedByMachineId: replacement.id };
        storage.setState({ machines: { [predecessor.id]: predecessor, [replacement.id]: replacement } });
        expect(build([predecessor, replacement]).reachableSessionDisplayByKey.get('server-a:session-1')).toMatchObject({
            machineId: 'machine-2', machineLabel: 'Replacement',
        });

        const moved = { ...session, metadata: { ...session.metadata!, path: '/Users/tester/moved' } };
        storage.setState({ sessions: { [moved.id]: moved } });
        expect(build([predecessor, replacement], [{ ...items[0], type: 'session', session: moved }])
            .reachableSessionDisplayByKey.get('server-a:session-1')?.workspaceSubtitle).toBe('moved');
    });
});
