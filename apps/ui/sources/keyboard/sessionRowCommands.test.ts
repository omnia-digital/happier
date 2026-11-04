import { describe, expect, it } from 'vitest';

import { sessionRowMenuCommandIds } from '@/components/sessions/shell/row/actionMenu/sessionRowMenuKeyboard';

import { defaultKeyboardCommands } from './commands';

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
});
