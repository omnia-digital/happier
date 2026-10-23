import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';
import { t } from '@/text';
import { buildSessionReachableDisplay } from '../sessionListReachabilityModels';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;
type RowBucketEntry = Readonly<{
    sourceIndex: number;
    row: SessionRow;
    lineage: ReadonlyArray<Header>;
    workspace: ReturnType<typeof buildSessionReachableDisplay>['workspace'];
}>;
type EmptyHeaderBucketEntry = Readonly<{
    sourceIndex: number;
    header: Header;
    lineage: ReadonlyArray<Header>;
    workspace: ReturnType<typeof resolveSessionWorkspacePresentation>;
}>;
type BucketEntry = RowBucketEntry | EmptyHeaderBucketEntry;
type MachineBucket = {
    serverId: string;
    serverName?: string;
    machineId: string | null;
    machine: MachineDisplayRenderable | null;
    label: string;
    entries: BucketEntry[];
};

const BAND_KINDS = new Set(['server', 'active', 'inactive', 'sessions', 'pinned', 'attention', 'working']);

function scopedGroupKey(band: string, serverId: string, machineId: string | null, key: string): string {
    return `machine-view:${band}:${serverId || '__unknown_server__'}:${machineId || '__unknown_machine__'}:${key}`;
}

function projectBand(
    items: ReadonlyArray<SessionListViewItem>,
    band: string,
    machines: Readonly<Record<string, MachineDisplayRenderable>>,
    workspaceLabelsV1: Readonly<Record<string, string>>,
): SessionListViewItem[] {
    if (items.length === 0) return [];
    const first = items[0];
    const bandHeader = first.type === 'header' && BAND_KINDS.has(first.headerKind ?? '') ? first : null;
    const body = bandHeader ? items.slice(1) : items;
    const buckets = new Map<string, MachineBucket>();
    const headersWithRows = new Set<Header>();
    let lineage: Header[] = [];
    const addEntry = (input: Readonly<{
        serverId: string;
        serverName?: string;
        machineId: string | null;
        machine: MachineDisplayRenderable | null;
        label: string;
        entry: BucketEntry;
    }>) => {
        const key = `${input.serverId}\u0000${input.machineId ?? ''}`;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = {
                serverId: input.serverId,
                serverName: input.serverName,
                machineId: input.machineId,
                machine: input.machine,
                label: input.label,
                entries: [],
            };
            buckets.set(key, bucket);
        }
        bucket.entries.push(input.entry);
    };

    for (const [sourceIndex, item] of body.entries()) {
        if (item.type === 'header') {
            if (item.headerKind === 'folder') {
                const depth = item.depth ?? 0;
                const folderIndex = lineage.findIndex((header) => header.headerKind === 'folder');
                const base = folderIndex >= 0 ? lineage.slice(0, folderIndex) : lineage;
                const folders = folderIndex >= 0 ? lineage.slice(folderIndex, folderIndex + depth) : [];
                lineage = [...base, ...folders, item];
            } else {
                lineage = [item];
            }
            const scope = item.workspace?.t === 'workspaceScope' ? item.workspace : item.workspaceScopeHint;
            const workspace = resolveSessionWorkspacePresentation({
                metadata: { machineId: scope?.machineId ?? item.machine?.id, path: scope?.rootPath },
                machines,
                target: scope?.machineId ? { machineId: scope.machineId, basePath: scope.rootPath } : undefined,
                workspaceLabelsV1,
            });
            const machineId = workspace.machineId;
            addEntry({
                serverId: (item.serverId ?? scope?.serverId ?? '').trim(),
                serverName: item.serverName,
                machineId,
                machine: machineId ? workspace.machine : null,
                label: machineId ? workspace.machineLabel : t('runs.unknownMachine'),
                entry: { sourceIndex, header: item, lineage, workspace },
            });
            continue;
        }
        const serverId = item.serverId?.trim() ?? '';
        const reachable = buildSessionReachableDisplay({ item, machinesById: machines, workspaceLabelsV1 });
        lineage.forEach((header) => headersWithRows.add(header));
        addEntry({
            serverId,
            serverName: item.serverName,
            machineId: reachable.display.machineId,
            machine: reachable.display.machineId ? reachable.workspace.machine : null,
            label: reachable.display.machineId ? reachable.display.machineLabel : t('runs.unknownMachine'),
            entry: { sourceIndex, row: item, lineage, workspace: reachable.workspace },
        });
    }

    for (const [key, bucket] of buckets) {
        bucket.entries = bucket.entries.filter((entry) => !('header' in entry) || !headersWithRows.has(entry.header));
        if (bucket.entries.length === 0) buckets.delete(key);
    }
    const orderedBuckets = [...buckets.values()].sort((left, right) => left.entries[0].sourceIndex - right.entries[0].sourceIndex);

    const out: SessionListViewItem[] = bandHeader ? [bandHeader] : [];
    const labelsByServer = new Map<string, Set<string>>();
    const labelCountByServer = new Map<string, number>();
    for (const bucket of orderedBuckets) {
        const servers = labelsByServer.get(bucket.label) ?? new Set<string>();
        servers.add(bucket.serverId);
        labelsByServer.set(bucket.label, servers);
        const labelServerKey = `${bucket.label}\u0000${bucket.serverId}`;
        labelCountByServer.set(labelServerKey, (labelCountByServer.get(labelServerKey) ?? 0) + 1);
    }
    for (const bucket of orderedBuckets) {
        const machineKey = scopedGroupKey(band, bucket.serverId, bucket.machineId, 'machine');
        const repeatedAcrossServers = (labelsByServer.get(bucket.label)?.size ?? 0) > 1;
        const repeatedOnServer = (labelCountByServer.get(`${bucket.label}\u0000${bucket.serverId}`) ?? 0) > 1;
        const serverLabel = bucket.serverName || t('runs.serverTitle', { serverId: bucket.serverId || '?' });
        const disambiguator = [
            ...(repeatedAcrossServers ? [serverLabel] : []),
            ...(repeatedOnServer ? [bucket.machineId ?? t('runs.unknownMachine')] : []),
        ].join(' · ');
        out.push({
            type: 'header',
            headerKind: 'machine',
            title: disambiguator ? `${bucket.label} (${disambiguator})` : bucket.label,
            groupKey: machineKey,
            serverId: bucket.serverId || undefined,
            serverName: bucket.serverName,
            machine: bucket.machine ?? undefined,
        });

        let previousLineage: ReadonlyArray<Header> = [];
        for (const entry of bucket.entries) {
            const row = 'row' in entry ? entry.row : null;
            let shared = 0;
            while (shared < previousLineage.length && shared < entry.lineage.length && previousLineage[shared] === entry.lineage[shared]) {
                shared += 1;
            }
            for (const ancestor of entry.lineage.slice(shared)) {
                const scopedKey = scopedGroupKey(band, bucket.serverId, bucket.machineId, ancestor.groupKey ?? `${ancestor.headerKind}:${ancestor.title}`);
                const workspaceScope = bucket.machineId && entry.workspace.pathKey
                    ? { serverId: bucket.serverId, machineId: bucket.machineId, rootPath: entry.workspace.pathKey }
                    : null;
                const projectMovedToDifferentMachine = ancestor.headerKind === 'project'
                    && ancestor.workspaceScopeHint?.machineId !== bucket.machineId;
                const projectWorkspaceKey = projectMovedToDifferentMachine
                    ? entry.workspace.workspaceKey
                    : ancestor.workspaceKey;
                out.push({
                    ...ancestor,
                    groupKey: scopedKey,
                    ...(ancestor.headerKind === 'project' ? {
                        workspaceKey: projectWorkspaceKey,
                        workspaceScopeHint: workspaceScope,
                        seedSessionId: row?.session.id ?? ancestor.seedSessionId,
                        machine: bucket.machine ?? undefined,
                        subtitle: bucket.label,
                    } : {}),
                    ...(ancestor.headerKind === 'folder' ? { workspace: row?.workspace ?? ancestor.workspace } : {}),
                });
            }
            if (row) {
                const rowGroupKey = row.groupKey;
                out.push(rowGroupKey && entry.lineage.length > 0
                    ? { ...row, groupKey: scopedGroupKey(band, bucket.serverId, bucket.machineId, rowGroupKey) }
                    : row);
            }
            previousLineage = entry.lineage;
        }
    }
    return out;
}

export function projectSessionListMachineView(
    items: ReadonlyArray<SessionListViewItem>,
    machinesById: Readonly<Record<string, MachineDisplayRenderable>>,
    workspaceLabelsV1: Readonly<Record<string, string>> = {},
): SessionListViewItem[] {
    if (items.length === 0) return items as SessionListViewItem[];
    const out: SessionListViewItem[] = [];
    let bandStart = 0;
    for (let index = 1; index <= items.length; index += 1) {
        const item = items[index];
        if (index < items.length && (item.type !== 'header' || !BAND_KINDS.has(item.headerKind ?? ''))) continue;
        const bandItems = items.slice(bandStart, index);
        const first = bandItems[0];
        const band = first?.type === 'header' && BAND_KINDS.has(first.headerKind ?? '')
            ? JSON.stringify([first.headerKind, first.serverId ?? '', first.groupKey ?? ''])
            : 'ungrouped';
        out.push(...projectBand(bandItems, band, machinesById, workspaceLabelsV1));
        bandStart = index;
    }
    return out;
}
