import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_SET_ATTENTION_STANDING_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_STOP_ID,
} from '@/components/sessions/actions/sessionActionIds';

import { buildSessionRowMoreMenuItems } from './buildSessionRowActionMenuItems';
import { getSelectableMenuChoiceKeyboardHint } from '@/components/ui/forms/dropdown/useSelectableMenu';

describe('buildSessionRowMoreMenuItems', () => {
    it('allows an on-demand move picker without precomputed destination menu items', () => {
        const target = createSessionActionTarget({
            session: { id: 'session_1', active: false, createdAt: 1, metadata: null,
                seq: 0, updatedAt: 1, activeAt: 1, metadataVersion: 1, agentStateVersion: 1,
                thinking: false, thinkingAt: 0, presence: 1 },
            serverId: 'server_1', currentUserId: null, isConnected: true, isPinned: false,
        });
        const move = buildSessionRowMoreMenuItems({ target, iconColor: '#999', canMoveToFolder: true })
            .find((item) => item.id === SESSION_ACTION_MOVE_TO_FOLDER_ID);
        expect(move).toMatchObject({ disabled: false });
    });

    it('composes shared session actions with the row move-to-folder action', () => {
        const session: SessionListRenderableSession = {
            id: 'session_1',
            active: true,
            archivedAt: null,
            owner: 'user_1',
            accessLevel: undefined,
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: true,
            isPinned: false,
        });

        const items = buildSessionRowMoreMenuItems({
            target,
            iconColor: '#999',
            canMoveToFolder: true,
        });

        expect(items.map((item) => item.id)).toEqual([
            SESSION_ACTION_RENAME_ID,
            SESSION_ACTION_MARK_UNREAD_ID,
            SESSION_ACTION_STOP_ID,
            SESSION_ACTION_ARCHIVE_ID,
            SESSION_ACTION_MOVE_TO_FOLDER_ID,
        ]);
        expect(items.at(-1)?.disabled).toBe(false);
    });

    it('places contextual items after frequent session actions', () => {
        const session: SessionListRenderableSession = {
            id: 'session_1',
            active: false,
            archivedAt: null,
            owner: 'user_1',
            accessLevel: undefined,
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: true,
            isPinned: false,
        });

        const items = buildSessionRowMoreMenuItems({
            target,
            iconColor: '#999',
            canMoveToFolder: false,
            leadingItems: [
                { id: 'session.copyDebugInformation', title: 'Copy information' },
            ],
        });

        expect(items.map((item) => item.id)).toEqual([
            SESSION_ACTION_RENAME_ID,
            SESSION_ACTION_MARK_UNREAD_ID,
            'session.copyDebugInformation',
            SESSION_ACTION_ARCHIVE_ID,
        ]);
    });

    it('puts frequent session actions first and offers a concise reminder submenu', () => {
        const session: SessionListRenderableSession = {
            id: 'session_attention',
            active: true,
            archivedAt: null,
            owner: 'user_1',
            accessLevel: undefined,
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: true,
            attentionStandingEnabled: true,
            attentionStanding: false,
        });

        const items = buildSessionRowMoreMenuItems({
            target,
            iconColor: '#999',
            canMoveToFolder: false,
            reminderPresets: [
                { rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 14 * 60 } },
            ],
            leadingItems: [{ id: 'session.fork', title: 'Fork session' }],
        });

        expect(items.map((item) => item.id)).toEqual([
            SESSION_ACTION_RENAME_ID,
            SESSION_ACTION_MARK_UNREAD_ID,
            SESSION_ACTION_SET_ATTENTION_STANDING_ID,
            'attention-reminder',
            'session.fork',
            SESSION_ACTION_STOP_ID,
            SESSION_ACTION_ARCHIVE_ID,
        ]);
        const reminder = items.find((item) => item.id === 'attention-reminder');
        expect(reminder?.subtitle).toBeUndefined();
        expect(reminder?.submenu?.items.map((item) => item.id)).toEqual([
            'attention-reminder:3600000',
            'attention-reminder:10800000',
            'attention-reminder:tomorrow',
            'attention-reminder:next-week',
            'attention-reminder:preset:relative_day:1:840',
            'attention-reminder:custom',
            'attention-reminder:manage-presets',
        ]);
        expect(reminder?.submenu?.items.find((item) => item.id.startsWith('attention-reminder:preset:'))?.shortcut).toBeUndefined();
    });

    it('shows an existing reminder in the parent, checks the exact choice, and offers removal', () => {
        const session: SessionListRenderableSession = {
            id: 'session_attention', active: true, archivedAt: null, owner: 'user_1', accessLevel: undefined,
            seq: 4, lastViewedSessionSeq: 4, latestTurnStatus: 'completed', createdAt: 1, updatedAt: 1,
            activeAt: 1, metadataVersion: 1, agentStateVersion: 1, metadata: null, thinking: false, thinkingAt: 0, presence: 1,
        };
        const target = createSessionActionTarget({
            session, serverId: 'server_1', currentUserId: 'user_1', isConnected: true,
            attentionStandingEnabled: true, attentionStanding: false,
        });
        const nowMs = new Date(2026, 8, 8, 14, 30).getTime();
        const remindAt = new Date(2026, 8, 9, 14, 0).getTime();

        const items = buildSessionRowMoreMenuItems({
            target,
            iconColor: '#999',
            reminder: { state: 'scheduled', remindAt },
            reminderNowMs: nowMs,
            reminderPresets: [{ rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 14 * 60 } }],
        });
        const reminder = items.find((item) => item.id === 'attention-reminder');

        expect(reminder?.title).toContain('·');
        expect(reminder?.submenu?.items.find((item) => item.id === 'attention-reminder:preset:relative_day:1:840')?.rightElement)
            .toBeDefined();
        expect(reminder?.submenu?.items.at(-1)?.id).toBe('attention-reminder:remove');
    });

    it('inserts a checked exact timestamp when the current reminder is not a preset', () => {
        const session = {
            id: 'session_custom', active: false, archivedAt: null, owner: 'user_1', accessLevel: undefined,
            seq: 4, lastViewedSessionSeq: 4, latestTurnStatus: 'completed', createdAt: 1, updatedAt: 1,
            activeAt: 1, metadataVersion: 1, agentStateVersion: 1, metadata: null, thinking: false, thinkingAt: 0, presence: 1,
        } as SessionListRenderableSession;
        const target = createSessionActionTarget({
            session, serverId: 'server_1', currentUserId: 'user_1', isConnected: true,
            attentionStandingEnabled: true, attentionStanding: false,
        });
        const reminder = buildSessionRowMoreMenuItems({
            target,
            iconColor: '#999',
            reminder: { state: 'scheduled', remindAt: 2_000_000 },
            reminderNowMs: 1_000_000,
        }).find((item) => item.id === 'attention-reminder');

        expect(reminder?.submenu?.items[0]?.id).toBe('attention-reminder:current');
        expect(reminder?.submenu?.items[0]?.rightElement).toBeDefined();
        expect(reminder?.submenu?.items[0]?.disabled).toBe(true);
    });

    it('shows the registered shortcut beside every available command and keeps reminder choices keyboard reachable', () => {
        const session = {
            id: 'session_shortcuts', active: true, archivedAt: null, owner: 'user_1', accessLevel: undefined,
            seq: 4, lastViewedSessionSeq: 4, latestTurnStatus: 'completed', createdAt: 1, updatedAt: 1,
            activeAt: 1, metadataVersion: 1, agentStateVersion: 1, metadata: null, thinking: false, thinkingAt: 0, presence: 1,
        } as SessionListRenderableSession;
        const target = createSessionActionTarget({
            session, serverId: 'server_1', currentUserId: 'user_1', isConnected: true,
            attentionStandingEnabled: true, attentionStanding: false,
        });
        const items = buildSessionRowMoreMenuItems({
            target, iconColor: '#999', canMoveToFolder: true,
            leadingItems: [{ id: 'session.fork', title: 'Fork session' }],
            reminderPresets: [{ rule: { kind: 'relative_day', daysAhead: 1, minuteOfDay: 14 * 60 } }],
            reminderChoiceKeyboardHint: getSelectableMenuChoiceKeyboardHint('web'),
            shortcutLabels: {
                'session.menu.rename': '⌥⇧E',
                'session.menu.readState': '⌥⇧U',
                'session.menu.attentionStanding': '⌥⇧K',
                'session.menu.reminder': '⌥⇧D',
                'session.menu.fork': '⌥⇧B',
                'session.menu.stop': '⌥⇧X',
                'session.hovered.archive': 'A',
                'sessions.row.moveToFolder': '⌥⇧F',
            },
        });
        const byId = new Map(items.map((item) => [item.id, item]));
        expect(byId.get(SESSION_ACTION_RENAME_ID)?.shortcut).toBe('⌥⇧E');
        expect(byId.get(SESSION_ACTION_MARK_UNREAD_ID)?.shortcut).toBe('⌥⇧U');
        expect(byId.get(SESSION_ACTION_SET_ATTENTION_STANDING_ID)?.shortcut).toBe('⌥⇧K');
        expect(byId.get('attention-reminder')?.shortcut).toBe('⌥⇧D');
        expect(byId.get('session.fork')?.shortcut).toBe('⌥⇧B');
        expect(byId.get(SESSION_ACTION_STOP_ID)?.shortcut).toBe('⌥⇧X');
        expect(byId.get(SESSION_ACTION_ARCHIVE_ID)?.shortcut).toBe('A');
        expect(byId.get(SESSION_ACTION_MOVE_TO_FOLDER_ID)?.shortcut).toBe('⌥⇧F');
        expect(byId.get('attention-reminder')?.submenu?.items.find((item) => item.id.startsWith('attention-reminder:preset:'))?.shortcut).toBe('↑↓ Enter');
    });
});
