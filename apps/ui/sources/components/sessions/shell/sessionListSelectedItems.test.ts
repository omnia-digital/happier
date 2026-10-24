import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

import { buildSessionListSelectedItems, type SessionListSelectedItem } from './sessionListSelectedItems';

const session = { id: 'session-a', active: false } as unknown as Extract<SessionListViewItem, { type: 'session' }>['session'];

function sessionItem(overrides: Partial<Extract<SessionListViewItem, { type: 'session' }>>): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session,
        section: 'inactive',
        groupKey: 'group-a',
        groupKind: 'date',
        variant: 'default',
        pinned: false,
        serverId: 'server-a',
        ...overrides,
    };
}

describe('buildSessionListSelectedItems', () => {
    it('moves current-session selection to the newly routed row while reusing unchanged rows', () => {
        const first = sessionItem({ session: { ...session, id: 'session-a' } as typeof session });
        const second = sessionItem({ session: { ...session, id: 'session-b' } as typeof session });
        const initial = buildSessionListSelectedItems({
            items: [first, second],
            pathname: '/session/session-a',
            selectable: true,
        });
        const previousFirst = initial?.[0];
        const next = buildSessionListSelectedItems({
            items: [first, second],
            pathname: '/session/session-b',
            selectable: true,
            previousItems: initial,
        });

        expect(next?.map((item) => item.type === 'session' ? item.selected : null)).toEqual([false, true]);
        expect(next?.[0]).not.toBe(previousFirst);
        expect(next?.[1]).not.toBe(initial?.[1]);
    });

    it('rebuilds a reused row when only its attention placement reason changed', () => {
        const previousItems: ReadonlyArray<SessionListSelectedItem> = [
            { ...sessionItem({}), selected: false },
        ];

        const next = buildSessionListSelectedItems({
            items: [sessionItem({ attentionPromotionReason: 'standing' })],
            pathname: '/sessions',
            selectable: true,
            previousItems,
        });

        expect(next?.[0]).toBeTruthy();
        expect(next?.[0]?.type).toBe('session');
        expect(next?.[0] && next[0].type === 'session' ? next[0].attentionPromotionReason : null).toBe('standing');
    });

    it('rebuilds a reused row when only its working placement reason changed', () => {
        const previousItems: ReadonlyArray<SessionListSelectedItem> = [
            { ...sessionItem({}), selected: false },
        ];

        const next = buildSessionListSelectedItems({
            items: [sessionItem({ workingPlacementReason: 'working' })],
            pathname: '/sessions',
            selectable: true,
            previousItems,
        });

        expect(next?.[0] && next[0].type === 'session' ? next[0].workingPlacementReason : null).toBe('working');
    });

    it('rebuilds a reused row when only its folder placement changed', () => {
        const previousItems: ReadonlyArray<SessionListSelectedItem> = [
            { ...sessionItem({ folderId: null, folderDepth: 0 }), selected: false },
        ];

        const next = buildSessionListSelectedItems({
            items: [sessionItem({ folderId: 'folder-a', folderDepth: 1 })],
            pathname: '/sessions',
            selectable: true,
            previousItems,
        });

        expect(next?.[0] && next[0].type === 'session' ? next[0].folderId : null).toBe('folder-a');
    });

    it('still reuses the previous row object when nothing changed', () => {
        const previous: SessionListSelectedItem = { ...sessionItem({ attentionPromotionReason: 'standing' }), selected: false };

        const next = buildSessionListSelectedItems({
            items: [sessionItem({ attentionPromotionReason: 'standing' })],
            pathname: '/sessions',
            selectable: true,
            previousItems: [previous],
        });

        expect(next?.[0]).toBe(previous);
    });
});
