import { afterEach, describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { buildMachineDisplayRenderableFromMachine } from '@/sync/domains/machines/machineDisplayRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { storage } from '@/sync/domains/state/storageStore';
import type { Machine } from '@/sync/domains/state/storageTypes';

import { buildSessionListReachabilityModels, createSessionListReachabilityModelsCache } from './sessionListReachabilityModels';

const initialState = storage.getState();
afterEach(() => storage.setState(initialState, true));

describe('session reachability display invalidation', () => {
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
