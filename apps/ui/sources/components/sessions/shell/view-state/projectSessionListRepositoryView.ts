import { buildSessionListIndexItemFromViewItem } from '@/sync/domains/session/listing/sessionListIndex';
import { reorderSessionListEntriesByKeys, sortSessionListIndexItemsByOrderingMode } from '@/sync/domains/session/listing/sessionListIndexOrdering';
import type { SessionListOrderingModeV1, SessionListOrderingSectionMode } from '@/sync/domains/session/listing/sessionListOrderingRules';
import type { SessionListFolderSortModeV1 } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { normalizeSessionPathForProjectGrouping } from '@/sync/domains/session/listing/sessionListProjectGroupingKeys';
import { readSessionMachineTargetState, resolveDisplayMachineTargetForSessionFromState } from '@/sync/ops/sessionMachineTarget';
import {
    readRepositoryAssociation, repositoryOrderKey, repositoryWorkspaceKey,
    type RepositoryWorkspace, type RepositoryCheckout, type SessionRepositoryAssociations,
} from '@/sync/domains/session/listing/sessionRepositoryIdentity';
import type { RepositoryDiscoveryWorkspace } from './sessionRepositoryDiscovery';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Block = { key: string; items: SessionListViewItem[] };
const BANDS = new Set(['server', 'active', 'inactive', 'sessions', 'pinned', 'attention', 'working', 'shared']);

export function resolveRepositoryDiscoveryWorkspace(item: SessionListViewItem, scope?: ServerAccountScope, project?: Header | null): RepositoryDiscoveryWorkspace | null {
    const workspace = item.workspace?.t === 'workspaceScope' ? item.workspace : null;
    const hint = item.type === 'header' ? item.workspaceScopeHint : null;
    const physical = workspace ?? hint ?? project?.workspaceScopeHint;
    const serverId = item.serverId ?? physical?.serverId ?? scope?.serverId ?? '';
    if (physical?.machineId && physical.rootPath) return { serverId, machineId: physical.machineId, path: physical.rootPath };
    if (item.type !== 'session') return null;
    const metadata = item.session.metadata;
    const target = resolveDisplayMachineTargetForSessionFromState({
        state: scope ? readSessionMachineTargetState(scope) : {}, sessionId: item.session.id, metadata,
    });
    if (!target?.machineId || !target.basePath || !serverId) return null;
    return { serverId, machineId: target.machineId, path: normalizeSessionPathForProjectGrouping(target.basePath, metadata?.homeDir ?? null) };
}

export function collectRepositoryDiscoveryWorkspaces(items: readonly SessionListViewItem[], scopes: Readonly<Record<string, ServerAccountScope | undefined>>): RepositoryDiscoveryWorkspace[] {
    const workspaces = new Map<string, RepositoryDiscoveryWorkspace>();
    let project: Header | null = null;
    for (const item of items) {
        if (item.type === 'header' && item.headerKind === 'project') project = item;
        else if (item.type === 'header' && BANDS.has(item.headerKind ?? '')) project = null;
        const target = resolveRepositoryDiscoveryWorkspace(item, scopes[item.serverId ?? ''], project);
        if (target) workspaces.set(JSON.stringify([target.serverId, target.machineId, target.path]), target);
    }
    return [...workspaces.values()];
}

function ordered<T extends { key: string }>(values: T[], keys: readonly string[] | undefined): T[] {
    return reorderSessionListEntriesByKeys(values.sort((a, b) => a.key.localeCompare(b.key)), keys ?? []);
}

export function projectSessionListRepositoryView(input: Readonly<{
    items: readonly SessionListViewItem[];
    scopes: Readonly<Record<string, ServerAccountScope | undefined>>;
    associations: SessionRepositoryAssociations;
    groupOrder?: Readonly<Record<string, readonly string[] | undefined>>;
    orderingMode?: SessionListOrderingModeV1;
    sectionMode?: SessionListOrderingSectionMode;
    folderSortMode?: SessionListFolderSortModeV1;
}>): SessionListViewItem[] {
    const output: SessionListViewItem[] = [];
    let band: Header | null = null;
    let entries: SessionListViewItem[] = [];
    const flush = () => {
        if (band) output.push(band);
        const bandKey = JSON.stringify([band?.headerKind ?? 'ungrouped', band?.serverId ?? '', band?.groupKey ?? '']);
        const buckets = new Map<string, { key: string; header: Header; blocks: Block[] }>();
        let project: Header | null = null;
        let folderBlock: Block | null = null;
        for (const item of entries) {
            if (item.type === 'header' && item.headerKind === 'project') { project = item; folderBlock = null; continue; }
            if (item.type === 'header' && item.headerKind === 'date') { project = null; folderBlock = null; continue; }
            if (item.type === 'header' && item.headerKind === 'folder' && (item.depth ?? 0) > 0 && folderBlock) { folderBlock.items.push(item); continue; }
            if (item.type === 'session' && item.folderId && folderBlock) { folderBlock.items.push(item); continue; }
            folderBlock = null;
            const sourceServerId = item.serverId ?? project?.serverId ?? '';
            const scope = input.scopes[sourceServerId];
            const serverId = scope?.serverId ?? sourceServerId;
            const target = resolveRepositoryDiscoveryWorkspace(item, scope, project);
            const workspace: RepositoryCheckout | null = target && scope ? { ...target, ...scope,
                ...(project?.seedSessionId ? { seedSessionId: project.seedSessionId } : item.type === 'session' ? { seedSessionId: item.session.id } : {}),
                ...(project?.subtitle ? { machineLabel: project.subtitle } : {}),
            } : null;
            const association = workspace ? readRepositoryAssociation(input.associations, workspace) : null;
            const identity = association?.manual?.identity ?? association?.identity ?? null;
            const fallbackKey = workspace ? repositoryWorkspaceKey({ ...workspace, path: association?.rootPath ?? workspace.path }) : JSON.stringify([serverId, target, item.type === 'session' ? item.session.id : item.folderId ?? item.groupKey]);
            const groupKey = repositoryOrderKey(JSON.stringify([bandKey, scope ?? serverId, identity ?? fallbackKey]));
            let bucket = buckets.get(groupKey);
            if (!bucket) {
                bucket = { key: `group:${groupKey}`, blocks: [], header: {
                    type: 'header', headerKind: 'project', groupKey, serverId, serverName: item.serverName,
                    title: association?.manual?.label ?? association?.label ?? target?.path ?? (item.type === 'header' ? item.title : item.session.id),
                    repository: { identity, checkouts: workspace ? [workspace] : [], orderScope: repositoryOrderKey(JSON.stringify(['groups', bandKey, scope ?? serverId])) },
                } };
                buckets.set(groupKey, bucket);
            } else if (workspace && !bucket.header.repository!.checkouts.some(checkout => repositoryWorkspaceKey(checkout) === repositoryWorkspaceKey(workspace))) {
                bucket.header.repository = { ...bucket.header.repository!, checkouts: [...bucket.header.repository!.checkouts, workspace] };
            }
            const block: Block = item.type === 'header'
                ? { key: `folder:${item.folderId}`, items: [item] }
                : { key: `${serverId}:${item.session.id}`, items: [{ ...item, serverId, groupKey, groupKind: item.pinned ? 'pinned' : 'project' }] };
            bucket.blocks.push(block);
            if (item.type === 'header' && item.headerKind === 'folder') folderBlock = block;
        }
        const scopes = new Map<string, typeof buckets extends Map<string, infer B> ? B[] : never>();
        for (const bucket of buckets.values()) {
            const orderScope = bucket.header.repository!.orderScope;
            const siblings = scopes.get(orderScope) ?? [];
            siblings.push(bucket); scopes.set(orderScope, siblings);
        }
        for (const siblings of scopes.values()) {
            for (const bucket of ordered(siblings, input.groupOrder?.[siblings[0].header.repository!.orderScope])) {
                output.push(bucket.header);
                const keys = input.groupOrder?.[bucket.header.groupKey!];
                const blocks = ordered(bucket.blocks, input.orderingMode && input.orderingMode !== 'custom' ? keys?.filter(key => key.startsWith('folder:')) : keys);
                const foldersFirst = input.folderSortMode !== 'mixed' || (input.orderingMode && input.orderingMode !== 'custom');
                const arranged = foldersFirst ? [...blocks.filter(block => block.key.startsWith('folder:')), ...blocks.filter(block => !block.key.startsWith('folder:'))] : blocks;
                for (const block of arranged) output.push(...block.items);
            }
        }
    };
    for (const item of input.items) {
        if (item.type === 'header' && BANDS.has(item.headerKind ?? '')) { flush(); band = item; entries = []; }
        else entries.push(item);
    }
    flush();
    if (!input.orderingMode || input.orderingMode === 'custom') return output;
    const index = output.map(buildSessionListIndexItemFromViewItem);
    const originals = new Map(index.map((item, i) => [item, output[i]]));
    const sessions = new Map(output.flatMap(item => item.type === 'session' ? [[`${item.serverId ?? ''}:${item.session.id}`, item.session] as const] : []));
    return sortSessionListIndexItemsByOrderingMode(index, input.orderingMode, (serverId, sessionId) => sessions.get(`${serverId ?? ''}:${sessionId}`) ?? null, { sectionMode: input.sectionMode }).map(item => originals.get(item)!);
}
