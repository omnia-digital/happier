import { describe, expect, it } from 'vitest';

import { buildVisibleSessionNavigationEntries } from './sessionNavigationOrder';

describe('numbered session navigation order', () => {
    it('uses the first visible row for each server-scoped target and skips headers', () => {
        expect(buildVisibleSessionNavigationEntries([
            { type: 'header' },
            { type: 'session', serverId: 'server-a', session: { id: 'alpha' } },
            { type: 'header' },
            { type: 'session', serverId: 'server-a', session: { id: 'alpha' } },
            { type: 'session', serverId: 'server-a', session: { id: 'beta' } },
            { type: 'session', serverId: 'server-b', session: { id: 'alpha' } },
        ])).toEqual([
            { index: 1, sessionId: 'alpha', sessionKey: 'server-a:alpha', serverId: 'server-a' },
            { index: 4, sessionId: 'beta', sessionKey: 'server-a:beta', serverId: 'server-a' },
            { index: 5, sessionId: 'alpha', sessionKey: 'server-b:alpha', serverId: 'server-b' },
        ]);
    });
});
