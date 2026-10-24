import { describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { darkTheme, lightTheme } from '@/theme';
import { parseThemeColor, themeContrastRatioOverLayers } from '@/theme/themeContrastMath';
import { MachineDisplayColorSchema } from '@/sync/domains/machines/machineDisplayIconPreference';
import { resolveMachineDisplayColor } from './machineDisplayColor';

function expectLegiblePalette(theme: typeof lightTheme) {
    // Session rows, machine group headers, context chips, dropdown rows and
    // machine-detail navigation use these actual theme-owned backgrounds.
    const surfaces = [
        [theme.colors.background.canvas],
        [theme.colors.chrome.header.background],
        [theme.colors.surface.base],
        [theme.colors.surface.elevated],
        [theme.colors.surface.selected],
        [theme.colors.surface.pressed],
        [theme.colors.surface.base, theme.colors.surface.pressedOverlay],
        [theme.colors.surface.selected, theme.colors.surface.pressedOverlay],
    ];
    for (const color of MachineDisplayColorSchema.options) {
        if (color === 'automatic') continue;
        const ink = resolveMachineDisplayColor(theme, color, theme.colors.text.secondary);
        for (const layers of surfaces) {
            expect(themeContrastRatioOverLayers(parseThemeColor(ink), layers), `${color} on ${layers.join(' + ')}`).toBeGreaterThanOrEqual(3);
        }
    }
}

describe('machine display color palette', () => {
    it.each([['light', lightTheme], ['dark', darkTheme]] as const)('keeps glyphs legible on %s normal, selected and hovered surfaces', (_, theme) => {
        expectLegiblePalette(theme);
    });

    it('also clears the contrast threshold for the iOS-specific theme accents', async () => {
        vi.resetModules();
        const select = vi.spyOn(Platform, 'select').mockImplementation((options) => options.ios ?? ('default' in options ? options.default : options.native));
        try {
            const iosThemes = await import('@/theme');
            expectLegiblePalette(iosThemes.lightTheme);
            expectLegiblePalette(iosThemes.darkTheme);
        } finally {
            select.mockRestore();
        }
    });

    it('preserves the caller foreground for Automatic', () => {
        expect(resolveMachineDisplayColor(lightTheme, 'automatic', lightTheme.colors.chrome.header.foreground))
            .toBe(lightTheme.colors.chrome.header.foreground);
        expect(resolveMachineDisplayColor(darkTheme, 'automatic', darkTheme.colors.text.secondary))
            .toBe(darkTheme.colors.text.secondary);
    });
});
