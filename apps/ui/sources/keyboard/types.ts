import type { TranslationKey } from '@/text';

export type KeyboardPlatform = 'macos' | 'ios' | 'windows' | 'linux' | 'android' | 'web';

export type KeyboardCommandId =
    | 'composer.abortConfirm'
    | 'composer.focus'
    | 'composer.sendImmediate'
    | 'composer.sendPending'
    | 'commandPalette.open'
    | 'mode.cycle'
    | 'permission.cycle'
    | 'shortcutsHelp.open'
    | 'session.new'
    | 'session.hovered.archive'
    | 'session.menu.select'
    | 'session.menu.rename'
    | 'session.menu.readState'
    | 'session.menu.attentionStanding'
    | 'session.menu.reminder'
    | 'session.menu.reminderOneHour'
    | 'session.menu.reminderThreeHours'
    | 'session.menu.reminderTomorrow'
    | 'session.menu.reminderNextWeek'
    | 'session.menu.reminderCustom'
    | 'session.menu.reminderManage'
    | 'session.menu.reminderRemove'
    | 'session.menu.sameSetup'
    | 'session.menu.deleteDraft'
    | 'session.menu.copyInformation'
    | 'session.menu.fork'
    | 'session.menu.stop'
    | 'session.menu.tags'
    | 'session.menu.pinState'
    | 'session.number.1'
    | 'session.number.2'
    | 'session.number.3'
    | 'session.number.4'
    | 'session.number.5'
    | 'session.number.6'
    | 'session.number.7'
    | 'session.number.8'
    | 'session.number.9'
    | 'session.mru.next'
    | 'session.mru.previous'
    | 'sessions.row.moveDown'
    | 'sessions.row.moveToFolder'
    | 'sessions.row.moveToWorkspaceRoot'
    | 'sessions.row.moveUp'
    | 'sessions.selection.clear'
    | 'sessions.selection.extendDown'
    | 'sessions.selection.extendUp'
    | 'sessions.selection.selectAll'
    | 'sessions.selection.toggleFocused'
    | 'session.visible.next'
    | 'session.visible.previous'
    | 'settings.open'
    | 'transcript.message.next'
    | 'transcript.message.previous'
    | 'transcript.selection.cancel'
    | 'transcript.selection.copy'
    | 'transcript.selection.selectAll'
    | 'transcript.selection.sendToSession'
    | 'transcript.scroll.bottom'
    | 'transcript.scroll.pageDown'
    | 'transcript.scroll.pageUp'
    | 'transcript.scroll.top';

export type KeyboardContext = Readonly<{
    isEditableTarget: boolean;
    isComposing: boolean;
    isOverlayActive?: boolean;
    isOwnedSessionRowMenuActive?: boolean;
}>;

export type NormalizedKeyboardEvent = Readonly<{
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isComposing: boolean;
}>;

export type KeybindingRule = Readonly<{
    binding: string;
    platforms?: readonly KeyboardPlatform[];
    blockedSurfaces?: readonly KeyboardSurface[];
    allowInEditable?: boolean;
}>;

export type KeyboardSurface = 'native' | 'web';

export type ParsedKeybindingRule = KeybindingRule & Readonly<{
    key?: string;
    code?: string;
    mod?: boolean;
    alt?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
}>;

export type KeyboardCommand = Readonly<{
    id: KeyboardCommandId;
    /** A contextual command can remain available when unrelated single-key shortcuts are disabled. */
    allowWhenSingleKeyShortcutsDisabled?: boolean;
    defaultBinding?: KeybindingRule;
    defaultBindings?: readonly KeybindingRule[];
    settingsTitleKey?: TranslationKey;
    when?: (context: KeyboardContext) => boolean;
}>;
