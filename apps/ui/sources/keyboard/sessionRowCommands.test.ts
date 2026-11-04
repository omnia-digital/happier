import { describe, expect, it, vi } from 'vitest';

import { sessionRowMenuCommandIds } from '@/components/sessions/shell/row/actionMenu/sessionRowMenuKeyboard';

import { formatKeybindingLabel, parseKeybindingRule, readKeybindingRuleModifierShape } from './bindings';
import { defaultKeyboardCommands } from './commands';
import { buildKeyboardShortcutLabels, createKeyboardShortcutDispatcher } from './runtime';

describe('session row keyboard commands', () => {
    it('registers move commands with non-editable default bindings', () => {
        const commands = new Map(defaultKeyboardCommands.map((command) => [command.id, command]));

        expect(commands.get('sessions.row.moveUp')?.defaultBinding).toMatchObject({ binding: 'Alt+Shift+ArrowUp' });
        expect(commands.get('sessions.row.moveDown')?.defaultBinding).toMatchObject({ binding: 'Alt+Shift+ArrowDown' });
        expect(commands.get('sessions.row.moveToFolder')?.defaultBinding).toMatchObject({ binding: 'Alt+Shift+F' });
        expect(commands.get('sessions.row.moveToWorkspaceRoot')?.defaultBinding).toMatchObject({ binding: 'Alt+Shift+R' });
        expect(commands.get('sessions.row.moveToFolder')?.when?.({
            isEditableTarget: true,
            isComposing: false,
        })).toBe(false);
    });

    it.each(sessionRowMenuCommandIds)('yields %s to editors and unrelated overlays but not to its own menu', (commandId) => {
        const when = defaultKeyboardCommands.find((command) => command.id === commandId)?.when;
        const context = { isEditableTarget: false, isComposing: false };

        expect(when?.(context)).toBe(true);
        expect(when?.({ ...context, isEditableTarget: true, isOwnedSessionRowMenuActive: true })).toBe(false);
        expect(when?.({ ...context, isOverlayActive: true })).toBe(false);
        expect(when?.({ ...context, isOverlayActive: true, isOwnedSessionRowMenuActive: true })).toBe(true);
    });

    it.each(['sessions.row.moveUp', 'sessions.row.moveDown', 'sessions.row.moveToWorkspaceRoot'])(
        'keeps %s behind every overlay, including an open row menu, because it only acts on the selected session',
        (commandId) => {
            const when = defaultKeyboardCommands.find((command) => command.id === commandId)?.when;
            const context = { isEditableTarget: false, isComposing: false };

            expect(when?.(context)).toBe(true);
            expect(when?.({ ...context, isEditableTarget: true })).toBe(false);
            expect(when?.({ ...context, isOverlayActive: true })).toBe(false);
            expect(when?.({ ...context, isOverlayActive: true, isOwnedSessionRowMenuActive: true })).toBe(false);
        },
    );

    it.each(sessionRowMenuCommandIds)('runs only %s from the binding its hint displays', (commandId) => {
        const handlers = Object.fromEntries(sessionRowMenuCommandIds.map((id) => [id, vi.fn(() => true)]));
        const options = { disabledCommandIds: [], overrides: {}, singleKeyShortcutsEnabled: true, handlers };
        const command = defaultKeyboardCommands.find((candidate) => candidate.id === commandId);
        const rule = parseKeybindingRule(command?.defaultBinding ?? command?.defaultBindings?.[0] ?? '');
        const modifiers = readKeybindingRuleModifierShape(rule, 'macos');
        const dispatch = createKeyboardShortcutDispatcher({
            ...options,
            enabled: true,
            platform: 'macos',
            surface: 'web',
            getContext: () => ({ isEditableTarget: false, isComposing: false }),
        });

        expect(buildKeyboardShortcutLabels('macos', 'web', { ...options, enabled: true })[commandId])
            .toBe(formatKeybindingLabel(rule, 'macos'));
        expect(dispatch({
            key: rule.key ?? '',
            code: rule.code ?? '',
            altKey: modifiers.alt,
            ctrlKey: modifiers.ctrl,
            metaKey: modifiers.meta,
            shiftKey: modifiers.shift,
            repeat: false,
            isComposing: false,
        })).toBe(true);
        expect(Object.entries(handlers).filter(([, handler]) => handler.mock.calls.length > 0).map(([id]) => id))
            .toEqual([commandId]);
    });
});
