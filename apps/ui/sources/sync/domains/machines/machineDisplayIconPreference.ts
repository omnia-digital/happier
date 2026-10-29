import { z } from 'zod';
import { getServerProfileLegacyServerIds, resolveServerProfileScopeIdForIdentifier } from '../server/serverProfiles';

export const MachineDisplayIconSchema = z.enum(['desktop', 'laptop', 'cloud', 'terminal']);
export type MachineDisplayIcon = z.infer<typeof MachineDisplayIconSchema>;

const DEFAULT_MACHINE_DISPLAY_ICON: MachineDisplayIcon = 'desktop';

export type MachineDisplayPreferenceScope = Readonly<{ serverId: string; legacyServerIds: readonly string[] }>;

export function findMachineDisplayScope(
    scopes: Readonly<Record<string, MachineDisplayPreferenceScope>> | undefined,
    serverId: string | null | undefined,
): MachineDisplayPreferenceScope | undefined {
    if (!scopes) return undefined;
    const id = serverId?.trim() ?? '';
    return scopes[id] ?? Object.values(scopes).find(scope => scope.serverId === id || scope.legacyServerIds.includes(id));
}

export function resolveMachineDisplayPreferenceScope(serverId: string): MachineDisplayPreferenceScope {
    const canonicalId = resolveServerProfileScopeIdForIdentifier(serverId);
    return { serverId: canonicalId, legacyServerIds: getServerProfileLegacyServerIds(canonicalId).filter(id => id !== canonicalId) };
}

function machineDisplayPreferenceKeys(scope: string | MachineDisplayPreferenceScope, machineId: string): string[] {
    const resolved = typeof scope === 'string' ? resolveMachineDisplayPreferenceScope(scope) : scope;
    return [resolved.serverId, ...resolved.legacyServerIds].map(serverId => JSON.stringify([serverId, machineId]));
}

function readPreference<T extends string>(values: Readonly<Record<string, T>>, scope: string | MachineDisplayPreferenceScope, machineId: string, fallback: T): T {
    for (const key of machineDisplayPreferenceKeys(scope, machineId)) {
        if (values[key] !== undefined) return values[key];
    }
    return fallback;
}

function withPreference<T extends string>(values: Readonly<Record<string, T>>, serverId: string, machineId: string, value: T, fallback: T): Record<string, T> {
    const [canonicalKey, ...legacyKeys] = machineDisplayPreferenceKeys(serverId, machineId);
    const storedValue = value === fallback ? undefined : value;
    if (values[canonicalKey] === storedValue && !legacyKeys.some(key => values[key] !== undefined)) return values as Record<string, T>;
    const next = { ...values };
    for (const key of legacyKeys) delete next[key];
    if (storedValue === undefined) delete next[canonicalKey];
    else next[canonicalKey] = storedValue;
    return next;
}

export function readMachineDisplayIcon(
    icons: Readonly<Record<string, MachineDisplayIcon>>,
    serverId: string | MachineDisplayPreferenceScope | null | undefined,
    machineId: string | null | undefined,
): MachineDisplayIcon {
    if (!serverId || !machineId) return DEFAULT_MACHINE_DISPLAY_ICON;
    return readPreference(icons, serverId, machineId, DEFAULT_MACHINE_DISPLAY_ICON);
}

export function withMachineDisplayIcon(
    icons: Readonly<Record<string, MachineDisplayIcon>>,
    serverId: string,
    machineId: string,
    icon: MachineDisplayIcon,
): Record<string, MachineDisplayIcon> {
    return withPreference(icons, serverId, machineId, icon, DEFAULT_MACHINE_DISPLAY_ICON);
}

// Store palette names, never theme-specific color values. Automatic preserves each
// caller's existing foreground and removing its entry restores that behavior.
export const MachineDisplayColorSchema = z.enum(['automatic', 'blue', 'purple', 'red']);
export type MachineDisplayColor = z.infer<typeof MachineDisplayColorSchema>;

export function readMachineDisplayColor(
    colors: Readonly<Record<string, MachineDisplayColor>>,
    serverId: string | MachineDisplayPreferenceScope | null | undefined,
    machineId: string | null | undefined,
): MachineDisplayColor {
    if (!serverId || !machineId) return 'automatic';
    return readPreference(colors, serverId, machineId, 'automatic');
}

export function withMachineDisplayColor(
    colors: Readonly<Record<string, MachineDisplayColor>>,
    serverId: string,
    machineId: string,
    color: MachineDisplayColor,
): Record<string, MachineDisplayColor> {
    return withPreference(colors, serverId, machineId, color, 'automatic');
}
