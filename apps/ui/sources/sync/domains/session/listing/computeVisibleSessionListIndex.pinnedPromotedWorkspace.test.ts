import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from './sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { computeVisibleSessionListIndex } from './computeVisibleSessionListIndex';

const serverId = 's1';
const projectKey = 'server:s1:active:project:repo';
const folderKey = `${projectKey}:folder:saved`;
const nowMs = 1_000_000;

function sourceWithSessions(...ids: string[]): SessionListIndexItem[] {
    return [
        { type: 'header', headerKind: 'active', title: 'Active', serverId },
        { type: 'header', headerKind: 'project', title: 'repo', serverId, groupKey: projectKey },
        { type: 'header', headerKind: 'folder', title: 'saved', serverId, groupKey: folderKey, folderId: 'saved', folderDepth: 0 },
        ...ids.map((sessionId): SessionListIndexItem => ({
            type: 'session', sessionId, serverId, section: 'active', groupKey: folderKey,
            groupKind: 'folder', folderId: 'saved', folderDepth: 1,
        })),
    ];
}

function row(id: string, working = false): SessionListRenderableSession {
    return {
        id,
        active: true,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 1,
        activeAt: nowMs - 1_000,
        presence: 'online',
        latestTurnStatus: working ? 'in_progress' : undefined,
        latestTurnStatusObservedAt: working ? nowMs - 1_000 : undefined,
        metadata: null,
        hasUnreadMessages: false,
        keepVisibleWhenInactive: false,
    } as SessionListRenderableSession;
}

function project(params: Readonly<{
    source: SessionListIndexItem[];
    rows: Record<string, SessionListRenderableSession>;
    pinned: string[];
    attention?: string;
    working?: boolean;
}>): SessionListIndexItem[] {
    return computeVisibleSessionListIndex({
        source: params.source,
        resolveSessionRow: (_serverId, sessionId) => params.rows[sessionId] ?? null,
        hideInactiveSessions: false,
        pinnedSessionKeysV1: params.pinned.map((id) => `${serverId}:${id}`),
        sessionListGroupOrderV1: {},
        sessionListOrderingModeV1: 'custom',
        presentation: { enabled: false, presentation: 'grouped' },
        attentionPromotion: params.attention
            ? { mode: 'global', retainedPlacements: [{ key: `${serverId}:${params.attention}`, reason: 'ready' }] }
            : undefined,
        workingPlacement: params.working ? { mode: 'global' } : undefined,
        nowMs,
    })!;
}

function summary(items: SessionListIndexItem[]): string[] {
    return items.map((item) => item.type === 'header'
        ? `h:${item.headerKind}`
        : `s:${item.sessionId}:${item.groupKind}:${item.pinned === true ? 'pinned' : 'unpinned'}`);
}

describe('pinned workspace source membership across global placement', () => {
    it('removes empty Active structure when its only pinned session moves into Attention', () => {
        const result = project({
            source: sourceWithSessions('p'),
            rows: { p: row('p') },
            pinned: ['p'],
            attention: 'p',
        });
        expect(summary(result)).toEqual(['h:attention', 's:p:attention:pinned']);
    });

    it('removes empty Active structure when its only pinned session moves into Working', () => {
        const result = project({
            source: sourceWithSessions('p'),
            rows: { p: row('p', true) },
            pinned: ['p'],
            working: true,
        });
        expect(summary(result)).toEqual(['h:working', 's:p:working:pinned']);
    });

    it('retains the source workspace and saved folder when an unpinned member is promoted', () => {
        const source = sourceWithSessions('p', 'u');
        const result = project({
            source,
            rows: { p: row('p'), u: row('u') },
            pinned: ['p'],
            attention: 'u',
        });
        expect(summary(result)).toEqual([
            'h:attention', 's:u:attention:unpinned',
            'h:pinned', 's:p:pinned:pinned',
            'h:active', 'h:project', 'h:folder',
        ]);
        expect(result.filter((item) => item.type === 'session').map((item) => item.sessionId)).toEqual(['u', 'p']);
        expect(source.filter((item) => item.type === 'session').map((item) => item.folderId)).toEqual(['saved', 'saved']);
    });
});
