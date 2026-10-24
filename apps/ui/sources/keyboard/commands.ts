import type { KeyboardCommand, KeyboardCommandId, KeyboardContext, KeybindingRule } from './types';

function whenSessionRowActionAllowed(context: KeyboardContext): boolean {
    return !context.isEditableTarget
        && (!context.isOverlayActive || context.isOwnedSessionRowMenuActive === true);
}

export const defaultKeyboardCommands: readonly KeyboardCommand[] = [
    {
        id: 'composer.abortConfirm',
        defaultBindings: [
            { binding: 'Mod+.', allowInEditable: true, platforms: ['web'] },
            { binding: 'Shift+Escape', allowInEditable: true, blockedSurfaces: ['web'] },
        ],
        settingsTitleKey: 'settingsKeyboard.commands.composerAbortConfirm',
    },
    {
        id: 'composer.focus',
        defaultBinding: { binding: 'Mod+I' },
        settingsTitleKey: 'settingsKeyboard.commands.composerFocus',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'composer.sendImmediate',
        defaultBinding: { binding: 'Mod+Enter', allowInEditable: true },
        settingsTitleKey: 'settingsKeyboard.commands.composerSendImmediate',
    },
    {
        id: 'composer.sendPending',
        defaultBinding: { binding: 'Mod+Shift+Enter', allowInEditable: true },
        settingsTitleKey: 'settingsKeyboard.commands.composerSendPending',
    },
    {
        id: 'commandPalette.open',
        defaultBindings: [
            { binding: 'Alt+K', platforms: ['web'] },
            { binding: 'Mod+K', blockedSurfaces: ['web'] },
        ],
        settingsTitleKey: 'settingsKeyboard.commands.commandPaletteOpen',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'mode.cycle',
        defaultBinding: { binding: 'Alt+Shift+M', allowInEditable: true },
        settingsTitleKey: 'settingsKeyboard.commands.modeCycle',
    },
    {
        id: 'permission.cycle',
    },
    {
        id: 'shortcutsHelp.open',
        defaultBinding: { binding: '?' },
        settingsTitleKey: 'settingsKeyboard.commands.shortcutsHelpOpen',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'session.new',
        defaultBindings: [
            { binding: 'Alt+N', platforms: ['web'] },
            { binding: 'Mod+Shift+N', blockedSurfaces: ['web'] },
        ],
        settingsTitleKey: 'settingsKeyboard.commands.sessionNew',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'session.hovered.archive',
        defaultBinding: { binding: 'A' },
        allowWhenSingleKeyShortcutsDisabled: true,
        settingsTitleKey: 'sessionInfo.archiveSession',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.select',
        defaultBinding: { binding: 'Alt+Shift+T' },
        settingsTitleKey: 'sessionsList.selectionSelectAction',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.rename',
        defaultBinding: { binding: 'Alt+Shift+E' },
        settingsTitleKey: 'sessionInfo.renameSession',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.readState',
        defaultBinding: { binding: 'Alt+Shift+U' },
        settingsTitleKey: 'sessionInfo.markSessionUnread',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.attentionStanding',
        defaultBinding: { binding: 'Alt+Shift+K' },
        settingsTitleKey: 'sessionInfo.keepInAttention',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminder',
        defaultBinding: { binding: 'Alt+Shift+D' },
        settingsTitleKey: 'sessionsList.reminders.title',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderOneHour',
        defaultBinding: { binding: 'Alt+Shift+1' },
        settingsTitleKey: 'sessionsList.reminders.inOneHour',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderThreeHours',
        defaultBinding: { binding: 'Alt+Shift+2' },
        settingsTitleKey: 'sessionsList.reminders.inThreeHours',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderTomorrow',
        defaultBinding: { binding: 'Alt+Shift+3' },
        settingsTitleKey: 'sessionsList.reminders.tomorrowMorning',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderNextWeek',
        defaultBinding: { binding: 'Alt+Shift+4' },
        settingsTitleKey: 'sessionsList.reminders.nextWeek',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderCustom',
        defaultBinding: { binding: 'Alt+Shift+5' },
        settingsTitleKey: 'sessionsList.reminders.custom',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderManage',
        defaultBinding: { binding: 'Alt+Shift+6' },
        settingsTitleKey: 'sessionsList.reminders.managePresets',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.reminderRemove',
        defaultBinding: { binding: 'Alt+Shift+7' },
        settingsTitleKey: 'sessionsList.reminders.remove',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.sameSetup',
        defaultBinding: { binding: 'Alt+Shift+N' },
        settingsTitleKey: 'sessionInfo.newSessionSameSetup',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.deleteDraft',
        defaultBinding: { binding: 'Alt+Shift+Y' },
        settingsTitleKey: 'sessionDrafts.delete.action',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.copyInformation',
        defaultBinding: { binding: 'Alt+Shift+I' },
        settingsTitleKey: 'sessionInfo.copyDebugInformation',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.fork',
        defaultBinding: { binding: 'Alt+Shift+B' },
        settingsTitleKey: 'sessionInfo.forkSession',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.stop',
        defaultBinding: { binding: 'Alt+Shift+X' },
        settingsTitleKey: 'sessionInfo.stopSession',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.tags',
        defaultBinding: { binding: 'Alt+Shift+G' },
        settingsTitleKey: 'sessionTags.editTagsLabel',
        when: whenSessionRowActionAllowed,
    },
    {
        id: 'session.menu.pinState',
        defaultBinding: { binding: 'Alt+Shift+P' },
        settingsTitleKey: 'sessionInfo.pinSession',
        when: whenSessionRowActionAllowed,
    },
    ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((number): KeyboardCommand => ({
        id: `session.number.${number}`,
        settingsTitleKey: `settingsKeyboard.commands.sessionNumber${number}`,
        defaultBinding: { binding: `Mod+${number}`, platforms: ['macos'] },
        when: (context) => !context.isEditableTarget && !context.isOverlayActive,
    })),
    {
        id: 'session.mru.next',
        defaultBindings: [
            { binding: 'Alt+PageDown', platforms: ['web'] },
            { binding: 'Ctrl+Tab', blockedSurfaces: ['web'] },
        ],
        settingsTitleKey: 'settingsKeyboard.commands.sessionMruNext',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'session.mru.previous',
        defaultBindings: [
            { binding: 'Alt+PageUp', platforms: ['web'] },
            { binding: 'Ctrl+Shift+Tab', blockedSurfaces: ['web'] },
        ],
        settingsTitleKey: 'settingsKeyboard.commands.sessionMruPrevious',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.row.moveUp',
        defaultBinding: { binding: 'Alt+Shift+ArrowUp' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsRowMoveUp',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.row.moveDown',
        defaultBinding: { binding: 'Alt+Shift+ArrowDown' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsRowMoveDown',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.row.moveToFolder',
        defaultBinding: { binding: 'Alt+Shift+F' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsRowMoveToFolder',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.row.moveToWorkspaceRoot',
        defaultBinding: { binding: 'Alt+Shift+R' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsRowMoveToWorkspaceRoot',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.selection.toggleFocused',
        defaultBinding: { binding: 'Space', platforms: ['web'] },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsSelectionToggleFocused',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.selection.extendUp',
        defaultBinding: { binding: 'Shift+ArrowUp', platforms: ['web'] },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsSelectionExtendUp',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.selection.extendDown',
        defaultBinding: { binding: 'Shift+ArrowDown', platforms: ['web'] },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsSelectionExtendDown',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.selection.selectAll',
        defaultBinding: { binding: 'Mod+A', platforms: ['web'] },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsSelectionSelectAll',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'sessions.selection.clear',
        defaultBinding: { binding: 'Escape', platforms: ['web'] },
        settingsTitleKey: 'settingsKeyboard.commands.sessionsSelectionClear',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'session.visible.next',
        defaultBinding: { binding: 'Alt+ArrowDown' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionVisibleNext',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'session.visible.previous',
        defaultBinding: { binding: 'Alt+ArrowUp' },
        settingsTitleKey: 'settingsKeyboard.commands.sessionVisiblePrevious',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'settings.open',
        settingsTitleKey: 'settingsKeyboard.commands.settingsOpen',
    },
    {
        id: 'transcript.message.next',
    },
    {
        id: 'transcript.message.previous',
    },
    {
        id: 'transcript.selection.cancel',
        defaultBinding: { binding: 'Escape' },
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.selection.copy',
        defaultBinding: { binding: 'Alt+Shift+C' },
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.selection.selectAll',
        defaultBinding: { binding: 'Alt+Shift+A' },
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.selection.sendToSession',
        defaultBinding: { binding: 'Alt+Shift+S' },
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.scroll.bottom',
        defaultBinding: { binding: 'End' },
        settingsTitleKey: 'settingsKeyboard.commands.transcriptScrollBottom',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.scroll.pageDown',
        defaultBinding: { binding: 'PageDown' },
        settingsTitleKey: 'settingsKeyboard.commands.transcriptScrollPageDown',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.scroll.pageUp',
        defaultBinding: { binding: 'PageUp' },
        settingsTitleKey: 'settingsKeyboard.commands.transcriptScrollPageUp',
        when: (context) => !context.isEditableTarget,
    },
    {
        id: 'transcript.scroll.top',
        defaultBinding: { binding: 'Home' },
        settingsTitleKey: 'settingsKeyboard.commands.transcriptScrollTop',
        when: (context) => !context.isEditableTarget,
    },
];

export function getDefaultKeybinding(commandId: KeyboardCommandId): KeybindingRule | undefined {
    const command = defaultKeyboardCommands.find((entry) => entry.id === commandId);
    return command?.defaultBindings?.[0] ?? command?.defaultBinding;
}
