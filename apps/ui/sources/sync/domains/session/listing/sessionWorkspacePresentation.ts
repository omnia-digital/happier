import { type MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { resolveCanonicalMachineId } from '@/sync/domains/machines/identity/resolveCanonicalMachineId';
import { findMachineInCollection, type MachineCollection } from '@/sync/domains/machines/identity/machineCollection';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';
import { normalizeNonEmptyString } from '@/utils/strings/normalizeNonEmptyString';

import {
    normalizeSessionPathForProjectGrouping,
    resolveSessionProjectGroupingKeyParts,
} from './sessionListProjectGroupingKeys';
import { readRepositoryAssociation, type SessionRepositoryAssociations } from './sessionRepositoryIdentity';

export type SessionWorkspacePresentationMetadata = Readonly<{
    host?: unknown;
    machineId?: unknown;
    path?: unknown;
    homeDir?: unknown;
}> | null | undefined;

export type SessionWorkspacePresentationTarget = Readonly<{
    machineId?: unknown;
    basePath?: unknown;
}> | null | undefined;

export const WorkspacePathDisplayModeV1SchemaValues = ['name', 'path'] as const;
export type WorkspacePathDisplayModeV1 = typeof WorkspacePathDisplayModeV1SchemaValues[number];

export type SessionWorkspacePresentation = Readonly<{
    groupKey: string;
    workspaceHash: string;
    workspaceKey: string;
    pathKey: string;
    displayPath: string;
    displayTitle: string;
    /** What a session is called on its row and header. Always a name, whatever the path display mode. */
    identityLabel: string;
    customLabel: string | null;
    hasCustomLabel: boolean;
    machineId: string | null;
    machine: MachineDisplayRenderable;
    machineLabel: string;
}>;

function makeUnknownMachine(id: string): MachineDisplayRenderable {
    return {
        id,
        updatedAt: 0,
        active: false,
        activeAt: 0,
        revokedAt: null,
        metadata: null,
        metadataVersion: 0,
    };
}

function hashFNV1a32Hex(input: string): string {
    // FNV-1a 32-bit. Used to avoid persisting raw local paths in synced keys.
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function readWorkspaceLabel(labels: unknown, workspaceKey: string): string | null {
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return null;
    return normalizeNonEmptyString((labels as Record<string, unknown>)[workspaceKey]);
}

function resolveMachineLabel(machine: MachineDisplayRenderable): string {
    return normalizeNonEmptyString(machine.metadata?.displayName)
        ?? normalizeNonEmptyString(machine.metadata?.host)
        ?? machine.id;
}

function resolveWorkspaceBasename(path: string): string {
    const normalized = path.trim().replace(/[\\/]+$/, '');
    if (!normalized || normalized === '~') return normalized;
    const segments = normalized.split(/[\\/]+/);
    return normalizeNonEmptyString(segments[segments.length - 1]) ?? normalized;
}

/**
 * A label without an identity is only the path of whichever checkout was discovered first, so it
 * names no one else's session. A remote identity reduces to its final segment; a repository group
 * the user named is shown as typed.
 */
function readRepositoryDisplayName(params: Readonly<{
    associations: SessionRepositoryAssociations | undefined;
    scope: ServerAccountScope | null | undefined;
    machineId: string | null;
    path: string;
}>): string | null {
    if (!params.associations || !params.scope || !params.machineId || !params.path) return null;
    const association = readRepositoryAssociation(params.associations, {
        ...params.scope,
        machineId: params.machineId,
        path: params.path,
    });
    if (association?.manual?.identity.startsWith('manual:')) return normalizeNonEmptyString(association.manual.label);
    const remoteLabel = association?.manual?.label ?? (association?.identity ? association.label : null);
    return remoteLabel ? normalizeNonEmptyString(resolveWorkspaceBasename(remoteLabel)) : null;
}

export function resolveSessionWorkspacePresentation(params: Readonly<{
    metadata: SessionWorkspacePresentationMetadata;
    machines: MachineCollection<MachineDisplayRenderable>;
    target?: SessionWorkspacePresentationTarget;
    workspaceLabelsV1?: unknown;
    workspacePathDisplayModeV1?: WorkspacePathDisplayModeV1 | null;
    sessionRepositoryAssociationsV1?: SessionRepositoryAssociations;
    /** The account the associations belong to. Without one, none of them can be attributed. */
    repositoryScope?: ServerAccountScope | null;
}>): SessionWorkspacePresentation {
    const parts = resolveSessionProjectGroupingKeyParts(params.metadata);
    const targetMachineId = normalizeNonEmptyString(params.target?.machineId);
    const targetPath = normalizeNonEmptyString(params.target?.basePath);
    const rawDisplayMachineId = targetMachineId ?? parts.machineId;
    const canonical = rawDisplayMachineId
        ? resolveCanonicalMachineId(rawDisplayMachineId, params.machines)
        : null;
    const displayMachineId = canonical?.reason === 'missingReplacementTarget'
        ? rawDisplayMachineId
        : canonical?.machineId ?? rawDisplayMachineId;
    const displayPathInput = targetPath ?? normalizeNonEmptyString(params.metadata?.path);
    const directMachine = displayMachineId ? findMachineInCollection(params.machines, displayMachineId) : undefined;
    const homeDir = normalizeNonEmptyString(directMachine?.metadata?.homeDir) ?? parts.homeDir;
    const pathKey = normalizeSessionPathForProjectGrouping(displayPathInput, homeDir);
    const machineGroupId = displayMachineId ? `id:${displayMachineId}` : parts.machineGroupId;
    const groupKey = `${machineGroupId}:${pathKey}`;
    const workspaceHash = hashFNV1a32Hex(groupKey);
    const workspaceKey = `wl_${workspaceHash}`;
    const displayPath = pathKey ? formatPathRelativeToHome(pathKey, homeDir ?? undefined) : '';
    const customLabel = readWorkspaceLabel(params.workspaceLabelsV1, workspaceKey);
    const directoryName = resolveWorkspaceBasename(displayPath || pathKey);
    const defaultDisplayTitle = params.workspacePathDisplayModeV1 === 'path' ? displayPath : directoryName;
    const repositoryName = readRepositoryDisplayName({
        associations: params.sessionRepositoryAssociationsV1,
        scope: params.repositoryScope,
        machineId: displayMachineId ?? null,
        path: pathKey,
    });
    const displayMachine = (() => {
        if (displayMachineId) {
            return directMachine ?? makeUnknownMachine(displayMachineId);
        }
        return makeUnknownMachine('unknown');
    })();

    return {
        groupKey,
        workspaceHash,
        workspaceKey,
        pathKey,
        displayPath,
        displayTitle: customLabel ?? defaultDisplayTitle,
        identityLabel: customLabel ?? repositoryName ?? directoryName,
        customLabel,
        hasCustomLabel: customLabel !== null,
        machineId: displayMachineId ?? null,
        machine: displayMachine,
        machineLabel: resolveMachineLabel(directMachine ?? displayMachine),
    };
}
