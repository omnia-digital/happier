import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { storage } from '@/sync/domains/state/storageStore';
import { upsertServerProfile, setActiveServerId } from '@/sync/domains/server/serverProfiles';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { StorageState } from '@/sync/store/types';
import { buildInboxSessionSummary } from './buildInboxSessionState';

import {
    buildInboxSessionSourceSignature,
    createInboxSessionSummarySelector,
    useInboxSessionState,
} from './useInboxSessionState';

describe('buildInboxSessionSourceSignature', () => {
    it('invalidates the mounted Inbox projection when the canonical runtime failure changes', () => {
        const session = createSessionFixture({
            latestTurnStatus: 'failed',
            latestTurnStatusObservedAt: 1_000,
            lastRuntimeIssue: null,
        });
        const before = buildInboxSessionSourceSignature(session);

        expect(buildInboxSessionSourceSignature({
            ...session,
            lastRuntimeIssue: {
                v: 1,
                scope: 'primary_session',
                status: 'failed',
                source: 'stream_error',
                code: 'provider_error',
                occurredAt: 1_000,
                sanitizedPreview: 'Provider failed',
            },
        })).not.toBe(before);
    });
});

describe('createInboxSessionSummarySelector', () => {
    it('classifies list members from the existing renderable projection without rebuilding hydrated session detail', () => {
        const nowMs = 1_000_000;
        const session = createSessionFixture({
            id: 'session-1',
            serverId: 'server-1',
            active: true,
            activeAt: nowMs,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: nowMs,
        });
        const renderable = {
            id: session.id,
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: nowMs,
            archivedAt: null,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 'online' as const,
            hasUnreadMessages: false,
            hasPendingPermissionRequests: true,
            pendingRequestObservedAt: nowMs,
            latestTurnStatus: 'in_progress' as const,
            latestTurnStatusObservedAt: nowMs,
        };
        const state = {
            sessions: { [session.id]: session },
            sessionMessages: {},
            sessionListRenderables: { [session.id]: renderable },
            sessionListViewDataByServerId: {
                'server-1': [{ type: 'session', serverId: 'server-1', session: renderable }],
            },
            sessionListRenderableDelta: {
                revision: 1,
                changedSessionIds: [session.id],
                removedSessionIds: [],
                rebuiltSessionListViewData: true,
            },
        } as unknown as StorageState;
        const buildSummary = vi.fn(buildInboxSessionSummary);

        expect(createInboxSessionSummarySelector(nowMs, buildSummary)(state).hasContent).toBe(true);
        expect(buildSummary).toHaveBeenCalledWith(expect.objectContaining({
            sessions: [],
        }));
    });

    it('retains the summary across unrelated store waves and updates through canonical Inbox policy', () => {
        const nowMs = 1_000_000;
        const session = createSessionFixture({
            id: 'session-1',
            active: true,
            activeAt: nowMs,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: nowMs,
        });
        let sessionRecordTraversals = 0;
        const sessions = new Proxy({ [session.id]: session }, {
            ownKeys(target) {
                sessionRecordTraversals += 1;
                return Reflect.ownKeys(target);
            },
        });
        const state = {
            sessions,
            sessionMessages: {},
            sessionListRenderables: {},
            sessionListViewDataByServerId: {},
            sessionListRenderableDelta: {
                revision: 1,
                changedSessionIds: [session.id],
                removedSessionIds: [],
                rebuiltSessionListViewData: true,
            },
        } as unknown as StorageState;
        const buildSummary = vi.fn(buildInboxSessionSummary);
        const selector = createInboxSessionSummarySelector(nowMs, buildSummary);
        const initial = selector(state);

        expect(initial.hasContent).toBe(false);
        expect(buildSummary).toHaveBeenCalledTimes(1);
        sessionRecordTraversals = 0;
        expect(selector({ ...state } as StorageState)).toBe(initial);
        expect(buildSummary).toHaveBeenCalledTimes(1);
        expect(sessionRecordTraversals).toBe(0);

        const actionableSession = {
            ...session,
            pendingPermissionRequestCount: 1,
            pendingRequestObservedAt: nowMs,
            agentState: {
                requests: {
                    permission_1: {
                        tool: 'Bash',
                        kind: 'permission' as const,
                        arguments: { command: 'pwd' },
                        createdAt: nowMs,
                    },
                },
                completedRequests: {},
            },
        };
        const actionable = selector({
            ...state,
            sessions: { [session.id]: actionableSession },
            sessionListRenderables: {},
            sessionListRenderableDelta: {
                revision: 2,
                changedSessionIds: [session.id],
                removedSessionIds: [],
                rebuiltSessionListViewData: false,
            },
        } as StorageState);

        expect(actionable.hasContent).toBe(true);
        expect(actionable).not.toBe(initial);
        expect(buildSummary).toHaveBeenCalledTimes(2);
    });

    it('retains cached contributions across clock ticks and reclassifies only expired sessions', () => {
        const nowMs = 1_000_000;
        const makeRenderable = (id: string, observedAt: number) => ({
            id,
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: observedAt,
            archivedAt: null,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: true,
            thinkingAt: observedAt,
            presence: 'online' as const,
            hasUnreadMessages: false,
            latestTurnStatus: 'in_progress' as const,
            latestTurnStatusObservedAt: observedAt,
        });
        const first = makeRenderable('session-1', nowMs - 100);
        const second = makeRenderable('session-2', nowMs);
        const state = {
            sessions: {},
            sessionMessages: {},
            sessionListRenderables: {
                'session-1': first,
                'session-2': second,
            },
            sessionListViewDataByServerId: {
                server_1: [
                    { type: 'session', serverId: 'server_1', session: first },
                    { type: 'session', serverId: 'server_1', session: second },
                ],
            },
            sessionListRenderableDelta: {
                revision: 1,
                changedSessionIds: ['session-1', 'session-2'],
                removedSessionIds: [],
                rebuiltSessionListViewData: true,
            },
        } as unknown as StorageState;
        const buildSummary = vi.fn(buildInboxSessionSummary);
        const selector = createInboxSessionSummarySelector(nowMs, buildSummary);
        const initial = selector(state, nowMs);

        expect(buildSummary).toHaveBeenCalledTimes(2);
        expect(selector(state, nowMs + 1)).toBe(initial);
        expect(buildSummary).toHaveBeenCalledTimes(2);

        const afterFirstExpiry = selector(state, nowMs + 119_900);
        expect(afterFirstExpiry.nextFreshnessAtMs).toBe(nowMs + 120_000);
        expect(buildSummary).toHaveBeenCalledTimes(3);
    });

    it('reclassifies only the changed cached session from the renderable delta', () => {
        const nowMs = 1_000_000;
        const makeRenderable = (id: string) => ({
            id,
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: nowMs,
            archivedAt: null,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: true,
            thinkingAt: nowMs,
            presence: 'online' as const,
            hasUnreadMessages: false,
            latestTurnStatus: 'in_progress' as const,
            latestTurnStatusObservedAt: nowMs,
        });
        const first = makeRenderable('session-1');
        const second = makeRenderable('session-2');
        const state = {
            sessions: {},
            sessionMessages: {},
            sessionListRenderables: {
                'session-1': first,
                'session-2': second,
            },
            sessionListViewDataByServerId: {
                server_1: [
                    { type: 'session', serverId: 'server_1', session: first },
                    { type: 'session', serverId: 'server_1', session: second },
                ],
            },
            sessionListRenderableDelta: {
                revision: 1,
                changedSessionIds: ['session-1', 'session-2'],
                removedSessionIds: [],
                rebuiltSessionListViewData: true,
            },
        } as unknown as StorageState;
        const buildSummary = vi.fn(buildInboxSessionSummary);
        const selector = createInboxSessionSummarySelector(nowMs, buildSummary);

        expect(selector(state).hasContent).toBe(false);
        expect(buildSummary).toHaveBeenCalledTimes(2);

        const actionableFirst = {
            ...first,
            hasPendingPermissionRequests: true,
            pendingRequestObservedAt: nowMs,
        };
        let changedListTraversals = 0;
        const changedServerItems = new Proxy([
            { type: 'session' as const, serverId: 'server_1', session: actionableFirst },
            { type: 'session' as const, serverId: 'server_1', session: second },
        ], {
            get(target, property, receiver) {
                if (property === Symbol.iterator) changedListTraversals += 1;
                return Reflect.get(target, property, receiver);
            },
        });
        const next = selector({
            ...state,
            sessionListRenderables: {
                'session-1': actionableFirst,
                'session-2': second,
            },
            sessionListViewDataByServerId: {
                server_1: changedServerItems,
            },
            sessionListRenderableDelta: {
                revision: 2,
                changedSessionIds: ['session-1'],
                removedSessionIds: [],
                rebuiltSessionListViewData: false,
            },
        } as StorageState);

        expect(next.hasContent).toBe(true);
        expect(buildSummary).toHaveBeenCalledTimes(3);
        expect(changedListTraversals).toBe(0);
    });

    it('does not replace a background server row with another server renderable that shares its session id', () => {
        const nowMs = 1_000_000;
        const backgroundAttention = {
            id: 'shared-id',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: nowMs,
            archivedAt: null,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 'online' as const,
            hasUnreadMessages: false,
            hasPendingPermissionRequests: true,
            pendingRequestObservedAt: nowMs,
            latestTurnStatus: 'in_progress' as const,
            latestTurnStatusObservedAt: nowMs,
        };
        const activeServerIdle = {
            ...backgroundAttention,
            hasPendingPermissionRequests: false,
            pendingRequestObservedAt: null,
        };
        const activeServerSession = createSessionFixture({
            id: 'shared-id',
            serverId: 'server-b',
        });
        const initialState = {
            sessions: { 'shared-id': activeServerSession },
            sessionMessages: {},
            sessionListRenderables: { 'shared-id': activeServerIdle },
            sessionListViewDataByServerId: {
                'server-a': [{ type: 'session', serverId: 'server-a', session: backgroundAttention }],
                'server-b': [{ type: 'session', serverId: 'server-b', session: activeServerIdle }],
            },
            sessionListRenderableDelta: {
                revision: 1,
                changedSessionIds: ['shared-id'],
                removedSessionIds: [],
                rebuiltSessionListViewData: true,
            },
        } as unknown as StorageState;
        const selector = createInboxSessionSummarySelector(nowMs);

        expect(selector(initialState).hasContent).toBe(true);

        const refreshedBackgroundAttention = {
            ...backgroundAttention,
            updatedAt: 2,
        };
        const next = selector({
            ...initialState,
            sessionListViewDataByServerId: {
                ...initialState.sessionListViewDataByServerId,
                'server-a': [{ type: 'session', serverId: 'server-a', session: refreshedBackgroundAttention }],
            },
            sessionListRenderableDelta: {
                revision: 2,
                changedSessionIds: ['shared-id'],
                removedSessionIds: [],
                rebuiltSessionListViewData: false,
            },
        } as StorageState);

        expect(next.hasContent).toBe(true);
    });
});


describe('mounted Inbox request freshness', () => {
    it('updates from a newer list request while open, then retires it when hydrated revision alone advances', async () => {
        const previous = storage.getState();
        vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `inbox-current-${Math.random()}`);
        const profile = upsertServerProfile({ serverUrl: 'https://inbox-current.example.test' });
        setActiveServerId(profile.id, { scope: 'device' });
        storage.setState(storage.getInitialState(), true);
        const now = Date.now();
        const session = createSessionFixture({ id: 'live-request', serverId: profile.id, active: true, activeAt: now,
            agentStateVersion: 1, agentState: null, latestTurnStatus: null,
        });
        storage.getState().applySessions([session]);
        const harness = await renderHook(() => useInboxSessionState());
        try {
            expect(harness.getCurrent().sessionsNeedingAttention).toEqual([]);
            const beforeUnrelated = harness.getCurrent();
            await act(async () => {
                storage.setState(state => ({ sessionListRenderables: { ...state.sessionListRenderables,
                    'outside-inbox-list': { ...state.sessionListRenderables[session.id], id: 'outside-inbox-list', seq: 99 },
                } }));
            });
            expect(harness.getCurrent()).toBe(beforeUnrelated);
            await act(async () => {
                storage.getState().applySessionListRenderablePatches([{ sessionId: session.id, patch: {
                    agentStateVersion: 2, hasPendingPermissionRequests: true, hasPendingUserActionRequests: false,
                    pendingRequestObservedAt: now,
                } }]);
            });
            expect(storage.getState().sessionListRenderables[session.id]).toMatchObject({ agentStateVersion: 2, hasPendingPermissionRequests: true });
            expect(storage.getState().sessionListViewDataByServerId[profile.id]?.filter(item => item.type === 'session').map(item => item.session.agentStateVersion)).toEqual([1]);
            expect(harness.getCurrent().sessionsNeedingAttention.map(entry => entry.reason)).toEqual(['permission_required']);
            // Hydration may catch up with a null agent state after the request was cleared.
            // Its revision changes the winning source even when the payload is unchanged.
            await act(async () => {
                storage.setState({ sessions: { [session.id]: { ...storage.getState().sessions[session.id], agentStateVersion: 3 } } });
            });
            expect(harness.getCurrent().sessionsNeedingAttention).toEqual([]);
        } finally {
            await harness.unmount();
            storage.setState(previous, true);
            vi.unstubAllEnvs();
        }
    });
});
