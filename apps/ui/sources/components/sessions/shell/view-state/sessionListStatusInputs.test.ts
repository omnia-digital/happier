import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { createSessionListStatusInputsSelector } from './sessionListStatusInputs';

describe('narrow status inputs overlay frozen structural rows', () => {
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
