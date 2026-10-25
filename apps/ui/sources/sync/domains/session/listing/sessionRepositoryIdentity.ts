import { isLoopbackHostname } from '@happier-dev/protocol';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { z } from 'zod';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { normalizeSessionPathForProjectGrouping } from './sessionListProjectGroupingKeys';

export function normalizeRepositoryRemote(raw: string): string | null {
    const value = raw.trim();
    if (!value || /%2f|%5c/i.test(value)) return null;
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value);
    const candidate = !value.includes('://') && scp && !/^[a-z]:[/\\]/i.test(value)
        ? `ssh://${scp[1]}/${scp[2]}` : value;
    try {
        const url = new URL(candidate);
        if (!['ssh:', 'https:', 'http:', 'git:'].includes(url.protocol)) return null;
        const host = url.hostname.toLowerCase();
        // Bare SSH aliases and local hosts cannot establish identity across machines.
        if ((!host.includes('.') && !host.includes(':')) || isLoopbackHostname(host) || host.endsWith('.local')) return null;
        const defaultPort = ({ 'ssh:': '22', 'https:': '443', 'http:': '80', 'git:': '9418' } as Record<string, string>)[url.protocol];
        const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
        const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
        if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
        return `${host}${port}/${path}`;
    } catch { return null; }
}

export function resolveRepositoryRemote(remotes: readonly { name: string; fetchUrl?: string; pushUrl?: string }[]): string | null {
    const origin = remotes.find((remote) => remote.name === 'origin');
    const selected = origin ?? (remotes.length === 1 ? remotes[0] : undefined);
    return selected?.fetchUrl ? normalizeRepositoryRemote(selected.fetchUrl) : null;
}

const RepositoryChoiceSchema = z.object({ identity: z.string().min(1), label: z.string().min(1) });
export const SessionRepositoryAssociationSchema = z.object({
    identity: z.string().nullable(),
    label: z.string(),
    rootPath: z.string(),
    worktreePaths: z.array(z.string()),
    manual: RepositoryChoiceSchema.optional(),
});
export const SessionRepositoryAssociationsSchema = z.record(z.string(), SessionRepositoryAssociationSchema).catch({});
export type SessionRepositoryAssociation = z.infer<typeof SessionRepositoryAssociationSchema>;
export type SessionRepositoryAssociations = z.infer<typeof SessionRepositoryAssociationsSchema>;
export type RepositoryAssociationChoice = z.infer<typeof RepositoryChoiceSchema>;
export type RepositoryWorkspace = Readonly<ServerAccountScope & { machineId: string; path: string }>;

export function repositoryWorkspaceKey(workspace: RepositoryWorkspace): string {
    return JSON.stringify([workspace.serverId, workspace.accountId, workspace.machineId, normalizeSessionPathForProjectGrouping(workspace.path, null)]);
}

export function repositoryOrderKey(identity: string): string {
    return `repository-v1:${bytesToHex(sha256(utf8ToBytes(identity)))}`;
}

function associationKeysForWorkspace(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace): string[] {
    const directKey = repositoryWorkspaceKey(workspace);
    const path = normalizeSessionPathForProjectGrouping(workspace.path, null);
    const prefix = `${JSON.stringify([workspace.serverId, workspace.accountId, workspace.machineId]).slice(0, -1)},`;
    return Object.keys(associations).filter(key => key === directKey || (key.startsWith(prefix)
        && (associations[key].rootPath === path || associations[key].worktreePaths.includes(path))));
}

export function readRepositoryAssociation(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace): SessionRepositoryAssociation | null {
    return associations[repositoryWorkspaceKey(workspace)] ?? associations[associationKeysForWorkspace(associations, workspace)[0]] ?? null;
}

export function withRepositoryAssociation(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace, discovered: SessionRepositoryAssociation): SessionRepositoryAssociations {
    const key = associationKeysForWorkspace(associations, workspace)[0] ?? repositoryWorkspaceKey(workspace);
    let previous: SessionRepositoryAssociation | undefined = associations[key];
    if (!previous) {
        for (const path of [discovered.rootPath, ...discovered.worktreePaths]) {
            previous = readRepositoryAssociation(associations, { ...workspace, path }) ?? undefined;
            if (previous) break;
        }
    }
    const next = { ...discovered, ...(previous?.manual ? { manual: previous.manual } : {}) };
    return JSON.stringify(associations[key]) === JSON.stringify(next) ? associations : { ...associations, [key]: next };
}

/** A worktree choice belongs to its discovered physical repository on this scoped machine. */
export function withManualRepositoryAssociation(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace, manual: SessionRepositoryAssociation['manual'] | null): SessionRepositoryAssociations {
    const previous = readRepositoryAssociation(associations, workspace);
    const paths = new Set([workspace.path, previous?.rootPath, ...(previous?.worktreePaths ?? [])].filter((path): path is string => Boolean(path)));
    const keys = new Set([...paths].flatMap(path => associationKeysForWorkspace(associations, { ...workspace, path })));
    if (keys.size === 0) {
        if (!manual) return associations;
        keys.add(repositoryWorkspaceKey(workspace));
    }
    let result = associations;
    for (const key of keys) {
        const current = associations[key] ?? { identity: null, label: workspace.path, rootPath: workspace.path, worktreePaths: [] };
        const { manual: _previousManual, ...automatic } = current;
        const next = manual ? { ...automatic, manual } : automatic;
        if (JSON.stringify(current) === JSON.stringify(next)) continue;
        if (result === associations) result = { ...associations };
        result[key] = next;
    }
    return result;
}

export function listRepositoryAssociationChoices(associations: SessionRepositoryAssociations, scope: ServerAccountScope): RepositoryAssociationChoice[] {
    const prefix = `${JSON.stringify([scope.serverId, scope.accountId]).slice(0, -1)},`;
    const choices = new Map<string, RepositoryAssociationChoice>();
    for (const [key, association] of Object.entries(associations)) {
        if (!key.startsWith(prefix)) continue;
        const choice = association.manual ?? (association.identity ? { identity: association.identity, label: association.label } : null);
        if (choice) choices.set(choice.identity, choice);
    }
    return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label) || a.identity.localeCompare(b.identity));
}

export type RepositoryCheckout = RepositoryWorkspace & Readonly<{ seedSessionId?: string; machineLabel?: string }>;

export type RepositoryHeaderPresentation = Readonly<{
    identity: string | null;
    checkouts: readonly RepositoryCheckout[];
    orderScope: string;
}>;
