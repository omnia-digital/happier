import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { createSessionListStatusInputsSelector } from './sessionListStatusInputs';
import { createSessionMessagesFixture } from '@/dev/testkit/fixtures/transcriptFixtures';

describe('narrow status inputs overlay frozen structural rows', () => {
    it('does no classifier work for 500 unchanged rows over 100 unrelated storage notifications', () => {
        let thinkingReads = 0;
        const sessions = Object.fromEntries(Array.from({ length: 500 }, (_, index) => {
            const session = buildSessionListRenderableFromSession(createSessionFixture({ id: 'session-' + index, active: true, presence: 'online', activeAt: 100_000 }));
            Object.defineProperty(session, 'thinking', { get() { thinkingReads++; return false; }, enumerable: true });
            return [session.id, session];
        }));
        const items = Object.values(sessions).map(session => ({ type: 'session' as const, serverId: 'home', session }));
        const selector = createSessionListStatusInputsSelector(items, 'home', () => 100_000, true);
        const state = { sessionListRenderables: sessions };
        const first = selector(state); thinkingReads = 0;
        const started = performance.now();
        for (let index = 0; index < 100; index++) expect(selector({ ...state })).toBe(first);
        console.info('OH60 status projection workload', { rows: 500, unrelatedNotifications: 100, thinkingReads, elapsedMs: performance.now() - started });
        expect(thinkingReads).toBe(0);
    });
    it('recomputes a runtime expiry when the clock advances without a storage update', () => {
        let now = 100_000;
        const session = buildSessionListRenderableFromSession(createSessionFixture({ id: 'session', active: true, presence: 'online', activeAt: now, thinking: true, thinkingAt: now }));
        const selector = createSessionListStatusInputsSelector([{ type: 'session', serverId: 'home', session }], 'home', () => now, true);
        const state = { sessionListRenderables: { session } };
        expect(selector(state).agentStatuses.get('home:session')).toBe('working');
        now += 120_001;
        expect(selector(state).agentStatuses.get('home:session')).toBe('idle');
    });
    it.each(['session-1', 'unrelated-session'])('does no classifier work for 500 rows over 100 streaming updates to %s', streamingSessionId => {
        let thinkingReads = 0;
        const sessions = Object.fromEntries(Array.from({ length: 500 }, (_, index) => {
            const session = buildSessionListRenderableFromSession(createSessionFixture({ id: 'session-' + index, active: true, presence: 'online', activeAt: 100_000 }));
            Object.defineProperty(session, 'thinking', { get() { thinkingReads++; return false; }, enumerable: true });
            return [session.id, session];
        }));
        const selector = createSessionListStatusInputsSelector(Object.values(sessions).map(session => ({ type: 'session', serverId: 'home', session })), 'home', () => 100_000, true);
        const state = { sessionListRenderables: sessions };
        const first = selector(state); thinkingReads = 0;
        const started = performance.now();
        for (let index = 0; index < 100; index++) {
            const sessionMessages = { [streamingSessionId]: createSessionMessagesFixture({ messageIdsOldestFirst: ['stream-' + index] }) };
            expect(selector({ ...state, sessionMessages })).toBe(first);
        }
        console.info('OH60 streaming projection workload', { rows: 500, notifications: 100, streamingSessionId, thinkingReads, elapsedMs: performance.now() - started });
        expect(thinkingReads).toBe(0);
    });
    it('follows current runtime/pending state without requiring a list-array rebuild or subscribing to unread/message progress', () => {
        const now = 100_000;
        const embedded = buildSessionListRenderableFromSession(createSessionFixture({ id: 'session', active: true, presence: 'online', activeAt: now }));
        const items = [{ type: 'session' as const, serverId: 'home', session: embedded }];
        const selector = createSessionListStatusInputsSelector(items, 'home', () => now, true);
        const state = { sessionListRenderables: { session: embedded } };
        const idle = selector(state); expect(idle.agentStatuses.get('home:session')).toBe('idle');
        const working = { ...embedded, thinking: true, thinkingAt: now };
        const active = selector({ sessionListRenderables: { session: working } });
        expect(active.agentStatuses.get('home:session')).toBe('working');
        expect(items[0].session).toBe(embedded);
        expect(selector({ sessionListRenderables: { session: { ...working, hasUnreadMessages: true, seq: 999 } } })).toBe(active);
        expect(selector({ sessionListRenderables: { session: { ...working, thinking: false, pendingCount: 2 } } }).agentStatuses.get('home:session')).toBe('queued');
    });
    it('does not overlay another Home with the active Home session sharing its id', () => {
        const embedded = buildSessionListRenderableFromSession(createSessionFixture({ id: 'session', active: true, presence: 'online' }));
        const selector = createSessionListStatusInputsSelector([{ type: 'session', serverId: 'other', session: embedded }], 'home', () => 100_000, true);
        expect(selector({ sessionListRenderables: { session: { ...embedded, hasPendingPermissionRequests: true } } }).agentStatuses.get('other:session')).toBe('idle');
    });
});
