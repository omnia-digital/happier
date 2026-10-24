import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import type { KeyboardCommandId } from '@/keyboard/types';
import type { SessionActionTarget } from '@/components/sessions/actions/sessionActionTypes';
import {
    SESSION_ACTION_ARCHIVE_ID,
    SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID,
    SESSION_ACTION_EDIT_TAGS_ID,
    SESSION_ACTION_MARK_READ_ID,
    SESSION_ACTION_MARK_UNREAD_ID,
    SESSION_ACTION_MOVE_TO_FOLDER_ID,
    SESSION_ACTION_PIN_ID,
    SESSION_ACTION_RENAME_ID,
    SESSION_ACTION_SET_ATTENTION_STANDING_ID,
    SESSION_ACTION_STOP_ID,
    SESSION_ACTION_UNARCHIVE_ID,
    SESSION_ACTION_UNPIN_ID,
} from '@/components/sessions/actions/sessionActionIds';
import { SESSION_NEW_SAME_SETUP_ACTION_ID } from '@/components/sessions/new/navigation/newSessionSameSetup';
import { SESSION_COPY_DEBUG_INFORMATION_MENU_ITEM_ID } from '@/components/sessions/debug/sessionDebugMenuItem';
import {
    SESSION_ATTENTION_REMINDER_CUSTOM_ID,
    SESSION_ATTENTION_REMINDER_MANAGE_PRESETS_ID,
    SESSION_ATTENTION_REMINDER_MENU_ID,
    SESSION_ATTENTION_REMINDER_NEXT_WEEK_ID,
    SESSION_ATTENTION_REMINDER_ONE_HOUR_ID,
    SESSION_ATTENTION_REMINDER_REMOVE_ID,
    SESSION_ATTENTION_REMINDER_THREE_HOURS_ID,
    SESSION_ATTENTION_REMINDER_TOMORROW_ID,
} from './sessionAttentionReminderAction';

export const SESSION_DELETE_DRAFT_MENU_ITEM_ID = 'session-draft.delete';
export const SESSION_ROW_MENU_SELECT_ID = 'selection.select';
export const SESSION_ROW_MENU_FORK_ID = 'session.fork';

export type SessionRowShortcutTarget = Readonly<{
    target: SessionActionTarget;
    items: readonly DropdownMenuItem[];
    execute: (itemId: string, options?: Readonly<{ forceArchiveConfirmation?: boolean }>) => Promise<void>;
    mutating: boolean;
}>;

const commandByItemId: Readonly<Record<string, KeyboardCommandId>> = {
    [SESSION_ROW_MENU_SELECT_ID]: 'session.menu.select',
    [SESSION_ACTION_RENAME_ID]: 'session.menu.rename',
    [SESSION_ACTION_MARK_READ_ID]: 'session.menu.readState',
    [SESSION_ACTION_MARK_UNREAD_ID]: 'session.menu.readState',
    [SESSION_ACTION_SET_ATTENTION_STANDING_ID]: 'session.menu.attentionStanding',
    [SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID]: 'session.menu.attentionStanding',
    [SESSION_ATTENTION_REMINDER_MENU_ID]: 'session.menu.reminder',
    [SESSION_ATTENTION_REMINDER_ONE_HOUR_ID]: 'session.menu.reminderOneHour',
    [SESSION_ATTENTION_REMINDER_THREE_HOURS_ID]: 'session.menu.reminderThreeHours',
    [SESSION_ATTENTION_REMINDER_TOMORROW_ID]: 'session.menu.reminderTomorrow',
    [SESSION_ATTENTION_REMINDER_NEXT_WEEK_ID]: 'session.menu.reminderNextWeek',
    [SESSION_ATTENTION_REMINDER_CUSTOM_ID]: 'session.menu.reminderCustom',
    [SESSION_ATTENTION_REMINDER_MANAGE_PRESETS_ID]: 'session.menu.reminderManage',
    [SESSION_ATTENTION_REMINDER_REMOVE_ID]: 'session.menu.reminderRemove',
    [SESSION_NEW_SAME_SETUP_ACTION_ID]: 'session.menu.sameSetup',
    [SESSION_DELETE_DRAFT_MENU_ITEM_ID]: 'session.menu.deleteDraft',
    [SESSION_COPY_DEBUG_INFORMATION_MENU_ITEM_ID]: 'session.menu.copyInformation',
    [SESSION_ROW_MENU_FORK_ID]: 'session.menu.fork',
    [SESSION_ACTION_STOP_ID]: 'session.menu.stop',
    [SESSION_ACTION_ARCHIVE_ID]: 'session.hovered.archive',
    [SESSION_ACTION_UNARCHIVE_ID]: 'session.hovered.archive',
    [SESSION_ACTION_MOVE_TO_FOLDER_ID]: 'sessions.row.moveToFolder',
    [SESSION_ACTION_EDIT_TAGS_ID]: 'session.menu.tags',
    [SESSION_ACTION_PIN_ID]: 'session.menu.pinState',
    [SESSION_ACTION_UNPIN_ID]: 'session.menu.pinState',
};

export const sessionRowMenuCommandIds = [...new Set(Object.values(commandByItemId))];

export function getSessionRowMenuCommandId(itemId: string): KeyboardCommandId | null {
    return commandByItemId[itemId] ?? null;
}

export function findVisibleSessionRowMenuItemForCommand(
    items: readonly DropdownMenuItem[],
    commandId: KeyboardCommandId,
): DropdownMenuItem | null {
    for (const item of items) {
        if (getSessionRowMenuCommandId(item.id) === commandId && item.disabled !== true) return item;
        if (item.submenu) {
            const nested = findVisibleSessionRowMenuItemForCommand(item.submenu.items, commandId);
            if (nested) return nested;
        }
    }
    return null;
}

export function withSessionRowMenuShortcutLabels(
    items: readonly DropdownMenuItem[],
    labels: Partial<Record<KeyboardCommandId, string>>,
): DropdownMenuItem[] {
    return items.map((item) => {
        const commandId = getSessionRowMenuCommandId(item.id);
        const shortcut = commandId ? labels[commandId] : undefined;
        const submenu = item.submenu ? {
            ...item.submenu,
            items: withSessionRowMenuShortcutLabels(item.submenu.items, labels),
        } : undefined;
        return {
            ...item,
            ...(shortcut ? { shortcut } : {}),
            ...(submenu ? { submenu } : {}),
        };
    });
}
