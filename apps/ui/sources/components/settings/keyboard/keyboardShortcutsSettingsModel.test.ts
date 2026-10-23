import { describe, expect, it } from 'vitest';

import type { Settings } from '@/sync/domains/settings/settings';

import {
    buildKeyboardShortcutResetDelta,
    buildKeyboardShortcutSetDelta,
    buildKeyboardShortcutSettingsModel,
    buildKeyboardShortcutToggleDelta,
} from './keyboardShortcutsSettingsModel';

const baseSettings = {
    commandPaletteEnabled: true,
    keyboardShortcutsV2Enabled: false,
    keyboardSingleKeyShortcutsEnabled: false,
    keyboardShortcutDisabledCommandIdsV1: [],
    keyboardShortcutOverridesV1: {},
} as Pick<
    Settings,
    | 'commandPaletteEnabled'
    | 'keyboardShortcutsV2Enabled'
    | 'keyboardSingleKeyShortcutsEnabled'
    | 'keyboardShortcutDisabledCommandIdsV1'
    | 'keyboardShortcutOverridesV1'
>;

describe('keyboardShortcutsSettingsModel', () => {
    it('builds command rows from the keyboard registry defaults', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: baseSettings,
            platform: 'macos',
            surface: 'native',
        });

        expect(model.commandRows.map((row) => row.commandId)).toEqual(expect.arrayContaining([
            'composer.sendPending',
            'commandPalette.open',
            'shortcutsHelp.open',
            'session.new',
            'settings.open',
        ]));
        expect(model.commandRows.find((row) => row.commandId === 'composer.sendPending')?.defaultLabel).toBe('Cmd+Shift+Enter');
        expect(model.commandRows.find((row) => row.commandId === 'commandPalette.open')?.defaultLabel).toBe('Cmd+K');
        expect(model.commandRows.find((row) => row.commandId === 'settings.open')?.defaultLabel).toBeNull();
    });

    it('lists all numbered session shortcuts with distinct titles and editable defaults', () => {
        const model = buildKeyboardShortcutSettingsModel({ settings: baseSettings, platform: 'macos', surface: 'native' });
        expect(model.commandRows.filter((row) => row.commandId.startsWith('session.number.'))).toEqual(
            Array.from({ length: 9 }, (_, index) => ({
                commandId: `session.number.${index + 1}`,
                titleKey: `settingsKeyboard.commands.sessionNumber${index + 1}`,
                bindingValue: `Mod+${index + 1}`,
                defaultLabel: `Cmd+${index + 1}`,
                disabled: false,
                hasOverride: false,
            })),
        );
    });

    it('disables, rebinds and resets a numbered shortcut through the settings controls', () => {
        const commandId = 'session.number.3';
        const disabled = { ...baseSettings, ...buildKeyboardShortcutToggleDelta([], commandId, true) };
        const rowFor = (settings: typeof baseSettings) => buildKeyboardShortcutSettingsModel({
            settings, platform: 'macos', surface: 'native',
        }).commandRows.find((row) => row.commandId === commandId);
        expect(rowFor(disabled)).toMatchObject({ disabled: true, bindingValue: 'Mod+3' });

        const rebound = { ...disabled, ...buildKeyboardShortcutSetDelta({
            disabledCommandIds: disabled.keyboardShortcutDisabledCommandIdsV1,
            overrides: disabled.keyboardShortcutOverridesV1,
            commandId,
            binding: 'Alt+3',
        }) };
        expect(rowFor(rebound)).toMatchObject({ disabled: false, bindingValue: 'Alt+3', hasOverride: true });

        const reset = { ...rebound, ...buildKeyboardShortcutResetDelta({
            disabledCommandIds: rebound.keyboardShortcutDisabledCommandIdsV1,
            overrides: rebound.keyboardShortcutOverridesV1,
            commandId,
        }) };
        expect(rowFor(reset)).toMatchObject({ disabled: false, bindingValue: 'Mod+3', hasOverride: false });
        expect(reset.keyboardShortcutsV2Enabled).toBe(false);
    });

    it('shows registry defaults even when single-key shortcuts are currently inactive', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: {
                ...baseSettings,
                keyboardSingleKeyShortcutsEnabled: false,
            },
            platform: 'macos',
            surface: 'web',
        });

        expect(model.commandRows.find((row) => row.commandId === 'shortcutsHelp.open')?.defaultLabel).toBe('?');
        const archive = model.commandRows.find((row) => row.commandId === 'session.hovered.archive');
        expect(archive).toMatchObject({
            titleKey: 'sessionInfo.archiveSession',
            defaultLabel: 'A',
            disabled: false,
        });
    });

    it('shows active web-safe defaults instead of browser-reserved native defaults', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: {
                ...baseSettings,
                keyboardSingleKeyShortcutsEnabled: true,
            },
            platform: 'macos',
            surface: 'web',
        });

        expect(model.conflicts).toEqual([]);
        expect(model.commandRows.find((row) => row.commandId === 'commandPalette.open')?.defaultLabel).toBe('Option+K');
        expect(model.commandRows.find((row) => row.commandId === 'session.new')?.defaultLabel).toBe('Option+N');
        expect(model.commandRows.find((row) => row.commandId === 'session.mru.next')?.defaultLabel).toBe('Option+PageDown');
        expect(model.commandRows.find((row) => row.commandId === 'mode.cycle')?.defaultLabel).toBe('Option+Shift+M');
        expect(model.commandRows.find((row) => row.commandId === 'composer.abortConfirm')?.defaultLabel).toBe('Cmd+.');
    });

    it('exposes only commands with translated settings titles', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: baseSettings,
            platform: 'macos',
            surface: 'native',
        });

        expect(model.commandRows.map((row) => row.commandId)).not.toEqual(expect.arrayContaining([
            'permission.cycle',
            'transcript.message.next',
            'transcript.message.previous',
        ]));
        expect(model.commandRows.every((row) => typeof row.titleKey === 'string' && row.titleKey.length > 0)).toBe(true);
    });

    it('ignores hidden commands when detecting conflicts for visible settings rows', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: baseSettings,
            platform: 'macos',
            surface: 'web',
        });

        expect(model.commandRows.map((row) => row.commandId)).toContain('sessions.selection.clear');
        expect(model.commandRows.map((row) => row.commandId)).not.toContain('transcript.selection.cancel');
        expect(model.conflicts).not.toContainEqual({
            id: 'duplicate:sessions.selection.clear:transcript.selection.cancel',
            kind: 'duplicate',
            commandIds: ['sessions.selection.clear', 'transcript.selection.cancel'],
        });
    });

    it('detects duplicate override bindings without exposing raw binding values', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: {
                ...baseSettings,
                keyboardShortcutOverridesV1: {
                    'commandPalette.open': [{ binding: 'Mod+K' }],
                    'session.new': [{ binding: 'Mod+K' }],
                },
            },
            platform: 'windows',
            surface: 'native',
        });

        expect(model.conflicts).toEqual([
            {
                id: 'duplicate:commandPalette.open:session.new',
                kind: 'duplicate',
                commandIds: ['commandPalette.open', 'session.new'],
            },
        ]);
    });

    it('detects browser-reserved conflicts through semantic binding aliases', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: {
                ...baseSettings,
                keyboardShortcutOverridesV1: {
                    'commandPalette.open': [{ binding: 'Mod+K' }],
                    'session.new': [{ binding: 'Cmd+N' }],
                },
            },
            platform: 'macos',
            surface: 'web',
        });

        expect(model.conflicts).toEqual([
            {
                id: 'browser-reserved:commandPalette.open',
                kind: 'browser-reserved',
                commandIds: ['commandPalette.open'],
            },
            {
                id: 'browser-reserved:session.new',
                kind: 'browser-reserved',
                commandIds: ['session.new'],
            },
        ]);
    });

    it('treats the legacy command palette toggle as the command palette shortcut enable state', () => {
        const model = buildKeyboardShortcutSettingsModel({
            settings: {
                ...baseSettings,
                commandPaletteEnabled: false,
            },
            platform: 'macos',
            surface: 'native',
        });

        expect(model.commandRows.find((row) => row.commandId === 'commandPalette.open')?.disabled).toBe(true);
    });

    it('builds disable and reset deltas without touching unrelated commands', () => {
        expect(buildKeyboardShortcutToggleDelta(['commandPalette.open'], 'session.new', true)).toEqual({
            keyboardShortcutDisabledCommandIdsV1: ['commandPalette.open', 'session.new'],
        });
        expect(buildKeyboardShortcutToggleDelta(['commandPalette.open', 'session.new'], 'commandPalette.open', false)).toEqual({
            keyboardShortcutDisabledCommandIdsV1: ['session.new'],
            commandPaletteEnabled: true,
        });
        expect(buildKeyboardShortcutToggleDelta([], 'commandPalette.open', true)).toEqual({
            keyboardShortcutDisabledCommandIdsV1: ['commandPalette.open'],
            commandPaletteEnabled: false,
        });

        expect(buildKeyboardShortcutResetDelta({
            disabledCommandIds: ['commandPalette.open', 'session.new'],
            overrides: {
                'commandPalette.open': [{ binding: 'Mod+K' }],
                'session.new': [{ binding: 'Mod+Shift+N' }],
            },
            commandId: 'commandPalette.open',
        })).toEqual({
            keyboardShortcutDisabledCommandIdsV1: ['session.new'],
            commandPaletteEnabled: true,
            keyboardShortcutOverridesV1: {
                'session.new': [{ binding: 'Mod+Shift+N' }],
            },
        });
    });

    it('builds set deltas that enable the command and persist a single validated override', () => {
        expect(buildKeyboardShortcutSetDelta({
            disabledCommandIds: ['commandPalette.open', 'session.new'],
            overrides: {
                'session.new': [{ binding: 'Mod+Shift+N' }],
            },
            commandId: 'commandPalette.open',
            binding: 'Alt+P',
        })).toEqual({
            keyboardShortcutDisabledCommandIdsV1: ['session.new'],
            commandPaletteEnabled: true,
            keyboardShortcutOverridesV1: {
                'session.new': [{ binding: 'Mod+Shift+N' }],
                'commandPalette.open': [{ binding: 'Alt+P' }],
            },
        });

        expect(buildKeyboardShortcutSetDelta({
            disabledCommandIds: [],
            overrides: {},
            commandId: 'session.new',
            binding: 'Cmd+',
        })).toBeNull();
    });
});
