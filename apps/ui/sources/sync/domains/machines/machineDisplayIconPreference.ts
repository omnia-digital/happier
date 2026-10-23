import { z } from 'zod';

export const MachineDisplayIconSchema = z.enum(['desktop', 'laptop', 'cloud', 'terminal']);
export type MachineDisplayIcon = z.infer<typeof MachineDisplayIconSchema>;

const DEFAULT_MACHINE_DISPLAY_ICON: MachineDisplayIcon = 'desktop';

function machineDisplayIconKey(serverId: string, machineId: string): string {
    return JSON.stringify([serverId, machineId]);
}

export function readMachineDisplayIcon(
    icons: Readonly<Record<string, MachineDisplayIcon>>,
    serverId: string | null | undefined,
    machineId: string | null | undefined,
): MachineDisplayIcon {
    if (!serverId || !machineId) return DEFAULT_MACHINE_DISPLAY_ICON;
    return icons[machineDisplayIconKey(serverId, machineId)] ?? DEFAULT_MACHINE_DISPLAY_ICON;
}

export function withMachineDisplayIcon(
    icons: Readonly<Record<string, MachineDisplayIcon>>,
    serverId: string,
    machineId: string,
    icon: MachineDisplayIcon,
): Record<string, MachineDisplayIcon> {
    const key = machineDisplayIconKey(serverId, machineId);
    if (readMachineDisplayIcon(icons, serverId, machineId) === icon) return icons as Record<string, MachineDisplayIcon>;
    const next = { ...icons };
    if (icon === DEFAULT_MACHINE_DISPLAY_ICON) delete next[key];
    else next[key] = icon;
    return next;
}

// Store palette names, never theme-specific color values. Automatic preserves each
// caller's existing foreground and removing its entry restores that behavior.
export const MachineDisplayColorSchema = z.enum(['automatic', 'blue', 'purple', 'red']);
export type MachineDisplayColor = z.infer<typeof MachineDisplayColorSchema>;

export function readMachineDisplayColor(
    colors: Readonly<Record<string, MachineDisplayColor>>,
    serverId: string | null | undefined,
    machineId: string | null | undefined,
): MachineDisplayColor {
    if (!serverId || !machineId) return 'automatic';
    return colors[machineDisplayIconKey(serverId, machineId)] ?? 'automatic';
}

export function withMachineDisplayColor(
    colors: Readonly<Record<string, MachineDisplayColor>>,
    serverId: string,
    machineId: string,
    color: MachineDisplayColor,
): Record<string, MachineDisplayColor> {
    const key = machineDisplayIconKey(serverId, machineId);
    if (readMachineDisplayColor(colors, serverId, machineId) === color) return colors as Record<string, MachineDisplayColor>;
    const next = { ...colors };
    if (color === 'automatic') delete next[key];
    else next[key] = color;
    return next;
}
