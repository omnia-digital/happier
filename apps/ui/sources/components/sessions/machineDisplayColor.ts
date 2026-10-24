import type { Theme } from '@/theme';
import type { MachineDisplayColor } from '@/sync/domains/machines/machineDisplayIconPreference';

// These existing accent tokens clear 3:1 on the machine glyph's ordinary,
// selected and hover surfaces in both built-in themes (see the contrast test).
export function resolveMachineDisplayColor(theme: Theme, color: MachineDisplayColor, automaticColor: string): string {
    return color === 'automatic' ? automaticColor : theme.colors.accent[color];
}
