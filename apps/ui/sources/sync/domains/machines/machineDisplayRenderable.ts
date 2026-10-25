import type { Machine, MachineMetadata } from '@/sync/domains/state/storageTypes';
import type { MachineCollection } from './identity/machineCollection';
import type { MachineDisplayPreferenceScope } from './machineDisplayIconPreference';

export interface MachineDisplayMetadata {
    displayName?: string | null;
    host?: string | null;
    homeDir?: string | null;
}

export interface MachineDisplayRenderable {
    id: string;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    revokedAt?: number | null;
    replacedByMachineId?: string | null;
    replacedAt?: number | string | null;
    replacementReason?: string | null;
    replacementSource?: string | null;
    replacementActorUserId?: string | null;
    metadataVersion: number;
    metadata: MachineDisplayMetadata | null;
}

export function buildMachineDisplayMetadata(metadata: MachineMetadata | null | undefined): MachineDisplayMetadata | null {
    if (!metadata) return null;
    return {
        displayName: typeof metadata.displayName === 'string' ? metadata.displayName : null,
        host: typeof metadata.host === 'string' ? metadata.host : null,
        homeDir: typeof metadata.homeDir === 'string' ? metadata.homeDir : null,
    };
}

const EMPTY_MACHINE_DISPLAYS: Readonly<Record<string, MachineDisplayRenderable>> = {};

/** Historical display retains retired machines and replacement chains, unlike launch selection. */
export function resolveMachineDisplayScope(input: Readonly<{
    serverId?: string | null;
    activeServerId?: string | null;
    resolvedScope?: MachineDisplayPreferenceScope;
    machines: Readonly<Record<string, MachineDisplayRenderable>>;
    machineListByServerId?: Readonly<Record<string, readonly MachineDisplayRenderable[] | null | undefined>>;
}>): Readonly<{ isActive: boolean; machines: MachineCollection<MachineDisplayRenderable> }> {
    const serverId = input.serverId?.trim();
    const scopeIds = input.resolvedScope
        ? [input.resolvedScope.serverId, ...input.resolvedScope.legacyServerIds]
        : serverId ? [serverId] : [];
    const isActive = !serverId || Boolean(input.activeServerId && scopeIds.includes(input.activeServerId));
    if (isActive) return { isActive, machines: input.machines };
    const lists = input.machineListByServerId ?? {};
    const key = scopeIds.find(id => Object.hasOwn(lists, id));
    return { isActive: false, machines: key ? lists[key] ?? EMPTY_MACHINE_DISPLAYS : EMPTY_MACHINE_DISPLAYS };
}

export function buildMachineDisplayRenderableFromMachine(machine: Machine): MachineDisplayRenderable {
    return {
        id: machine.id,
        updatedAt: machine.updatedAt,
        active: machine.active,
        activeAt: machine.activeAt,
        revokedAt: machine.revokedAt ?? null,
        replacedByMachineId: machine.replacedByMachineId ?? null,
        replacedAt: machine.replacedAt ?? null,
        replacementReason: machine.replacementReason ?? null,
        replacementSource: machine.replacementSource ?? null,
        replacementActorUserId: machine.replacementActorUserId ?? null,
        metadataVersion: machine.metadataVersion,
        metadata: buildMachineDisplayMetadata(machine.metadata),
    };
}

export function getMachineDisplaySubtitle(machine: MachineDisplayRenderable | undefined, machineId: string): string {
    const displayName = typeof machine?.metadata?.displayName === 'string' ? machine.metadata.displayName.trim() : '';
    if (displayName) return displayName;
    const host = typeof machine?.metadata?.host === 'string' ? machine.metadata.host.trim() : '';
    if (host) return host;
    return machine?.id ?? machineId;
}
