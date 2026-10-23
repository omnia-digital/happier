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
export type RepositoryWorkspace = Readonly<ServerAccountScope & { machineId: string; path: string }>;

export function repositoryWorkspaceKey(workspace: RepositoryWorkspace): string {
    return JSON.stringify([workspace.serverId, workspace.accountId, workspace.machineId, normalizeSessionPathForProjectGrouping(workspace.path, null)]);
}

export function repositoryOrderKey(identity: string): string {
    return `repository-v1:${bytesToHex(sha256(utf8ToBytes(identity)))}`;
}

export function readRepositoryAssociation(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace): SessionRepositoryAssociation | null {
    const direct = associations[repositoryWorkspaceKey(workspace)];
    if (direct) return direct;
    const path = normalizeSessionPathForProjectGrouping(workspace.path, null);
    for (const [key, association] of Object.entries(associations)) {
        // Only explicit worktree paths from this scoped machine are aliases.
        const prefix = `${JSON.stringify([workspace.serverId, workspace.accountId, workspace.machineId]).slice(0, -1)},`;
        if (!key.startsWith(prefix)) continue;
        if (association.rootPath === path || association.worktreePaths.includes(path)) return association;
    }
    return null;
}

export function withRepositoryAssociation(associations: SessionRepositoryAssociations, workspace: RepositoryWorkspace, discovered: SessionRepositoryAssociation): SessionRepositoryAssociations {
    const key = repositoryWorkspaceKey(workspace);
    const previous = associations[key];
    const next = { ...discovered, ...(previous?.manual ? { manual: previous.manual } : {}) };
    return JSON.stringify(previous) === JSON.stringify(next) ? associations : { ...associations, [key]: next };
}

export type RepositoryHeaderPresentation = Readonly<{
    identity: string | null;
    checkouts: readonly RepositoryWorkspace[];
    orderScope: string;
}>;
