import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from './sessionListRenderable';
import {
    normalizeSessionListStatusMode,
    readSessionListUpdatedOrderingKey,
    resolveSessionListFolderSortControl,
    SESSION_LIST_UPDATED_ORDERING_BUCKET_MS,
} from './sessionListOrderingRules';

function makeRow(partial: Partial<SessionListRenderableSession> = {}): SessionListRenderableSession {
    return {
        id: 's1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        meaningfulActivityAt: 650_000,
        active: false,
        activeAt: 0,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        ...partial,
    };
}

describe('readSessionListUpdatedOrderingKey', () => {
    it('falls back to the default bucket size when the provided bucket size truncates below one millisecond', () => {
        expect(readSessionListUpdatedOrderingKey(makeRow(), 0.5)).toEqual({
            bucket: Math.floor(650_000 / SESSION_LIST_UPDATED_ORDERING_BUCKET_MS),
            createdAtSecondary: 100,
        });
    });
});

describe('resolveSessionListFolderSortControl', () => {
    const unlocked = { orderingMode: 'custom', folderSortMode: 'mixed', statusGrouping: 'none', statusSorting: 'none' } as const;

    it('applies the saved choice and allows dragging in Custom order without status organization', () => {
        expect(resolveSessionListFolderSortControl(unlocked)).toEqual({
            effectiveMode: 'mixed', lock: null, dragBlockedByStatusSorting: false,
        });
    });

    it('locks to folders first under date ordering and under status grouping', () => {
        expect(resolveSessionListFolderSortControl({ ...unlocked, orderingMode: 'updated' })).toEqual({
            effectiveMode: 'foldersFirst', lock: 'dateOrdering', dragBlockedByStatusSorting: false,
        });
        expect(resolveSessionListFolderSortControl({ ...unlocked, statusGrouping: 'ticket' })).toEqual({
            effectiveMode: 'foldersFirst', lock: 'statusGrouping', dragBlockedByStatusSorting: false,
        });
    });

    it('reports both locks together so clearing one does not leave an unexplained lock', () => {
        expect(resolveSessionListFolderSortControl({ ...unlocked, orderingMode: 'created', statusGrouping: 'agent' })).toEqual({
            effectiveMode: 'foldersFirst', lock: 'statusGroupingAndDateOrdering', dragBlockedByStatusSorting: false,
        });
    });

    it('keeps the saved choice under status sorting, where folder positions still apply but dragging is off', () => {
        expect(resolveSessionListFolderSortControl({ ...unlocked, statusSorting: 'agent' })).toEqual({
            effectiveMode: 'mixed', lock: null, dragBlockedByStatusSorting: true,
        });
    });
});

describe('normalizeSessionListStatusMode', () => {
    it('keeps known modes and treats anything else as none', () => {
        expect(normalizeSessionListStatusMode('agent')).toBe('agent');
        expect(normalizeSessionListStatusMode('ticket')).toBe('ticket');
        expect(normalizeSessionListStatusMode(null)).toBe('none');
        expect(normalizeSessionListStatusMode('unknown')).toBe('none');
    });
});
