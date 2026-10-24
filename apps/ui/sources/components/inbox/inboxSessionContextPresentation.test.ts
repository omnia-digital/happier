import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';

import { buildInboxSessionContextByKey } from './inboxSessionContextPresentation';

function makeSession(path: string): SessionListRenderableSession {
    return {
        id: 'session-1',
        seq: 1,
        updatedAt: 1,
        createdAt: 1,
        active: false,
        activeAt: 1,
        archivedAt: null,
        metadata: { path, homeDir: '/home/leeroy', machineId: 'machine-1' },
        metadataVersion: 1,
        agentStateVersion: 1,
        pendingCount: 0,
        pendingBlockedCount: 0,
        pendingRequestObservedAt: null,
        hasPendingPermissionRequests: false,
        hasPendingUserActionRequests: false,
        hasUnreadMessages: true,
        latestTurnStatus: 'completed',
        latestTurnStatusObservedAt: 1,
        latestReadyEventSeq: 1,
        latestReadyEventAt: 1,
        lastViewedSessionSeq: 0,
        meaningfulActivityAt: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 0,
    };
}

describe('buildInboxSessionContextByKey', () => {
    it('uses the canonical workspace name instead of the raw full path', () => {
        const session = makeSession('/home/leeroy/Happier Core');
        const result = buildInboxSessionContextByKey({
            sessionByKey: new Map([['server-a:session-1', { serverId: 'server-a', sessionId: session.id, session }]]),
            machines: {},
            workspaceLabelsByServerId: new Map(),
        });

        expect(result.get('server-a:session-1')?.workspaceName).toBe('Happier Core');
        expect(result.get('server-a:session-1')?.workspaceName).not.toContain('/home/leeroy');
        expect(result.get('server-a:session-1')?.machineId).toBe('machine-1');
    });

    it('preserves the canonical custom workspace label for the exact Home', () => {
        const session = makeSession('/home/leeroy/project');
        const workspaceKey = resolveSessionWorkspacePresentation({ metadata: session.metadata, machines: {} }).workspaceKey;
        const result = buildInboxSessionContextByKey({
            sessionByKey: new Map([['server-a:session-1', { serverId: 'server-a', sessionId: session.id, session }]]),
            machines: {},
            workspaceLabelsByServerId: new Map([['server-a', { [workspaceKey]: 'Design System' }]]),
        });

        expect(result.get('server-a:session-1')?.workspaceName).toBe('Design System');
    });

    it('keeps the displayed successor name and icon identity together after machine replacement', () => {
        const session = makeSession('/home/leeroy/project');
        const result = buildInboxSessionContextByKey({
            sessionByKey: new Map([['server-a:session-1', { serverId: 'server-a', sessionId: session.id, session }]]),
            machines: {
                'machine-1': { id: 'machine-1', replacedByMachineId: 'machine-2', metadata: { host: 'old-host' } },
                'machine-2': { id: 'machine-2', metadata: { displayName: 'Successor' } },
            } as any,
            workspaceLabelsByServerId: new Map(),
        });

        expect(result.get('server-a:session-1')).toMatchObject({
            machineId: 'machine-2',
            machineLabel: 'Successor',
        });
    });
});
