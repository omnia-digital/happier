import { buildSessionListIndexItemFromViewItem } from '@/sync/domains/session/listing/sessionListIndex';
import { applySessionListIndexGroupOrdering, sortSessionListIndexItemsByOrderingMode } from '@/sync/domains/session/listing/sessionListIndexOrdering';
import type { SessionListFolderSortModeV1 } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import type { SessionListOrderingModeV1, SessionListOrderingSectionMode } from '@/sync/domains/session/listing/sessionListOrderingRules';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Block = { kind: 'folder' | 'session' | 'other'; items: SessionListViewItem[] };

const BANDS = new Set(['server', 'active', 'inactive', 'sessions', 'pinned', 'attention', 'working', 'shared']);
const RETAINED_GROUP_KINDS = new Set(['pinned', 'attention', 'working', 'shared']);

function flatGroupKey(band: Header | null): string {
    return `flat-v1:${JSON.stringify([band?.headerKind ?? 'ungrouped', band?.serverId ?? '', band?.groupKey ?? ''])}`;
}

type ProjectSessionListFlatViewInput = Readonly<{
    items: readonly SessionListViewItem[];
    groupOrder?: Readonly<Record<string, readonly string[] | undefined>>;
    orderingMode?: SessionListOrderingModeV1;
    sectionMode?: SessionListOrderingSectionMode;
    folderSortMode?: SessionListFolderSortModeV1;
}>;

function projectBand(entries: readonly SessionListViewItem[], band: Header | null, input: ProjectSessionListFlatViewInput): SessionListViewItem[] {
    const groupKey = flatGroupKey(band);
    const folderKey = (folderId: string) => `${groupKey}:folder:${folderId}`;
    const blocks: Block[] = [];
    let currentFolder: Block | null = null;
    for (const item of entries) {
        if (item.type === 'header') {
            if (item.headerKind === 'project' || item.headerKind === 'date' || item.headerKind === 'machine' || item.headerKind === 'status') {
                currentFolder = null;
                continue;
            }
            if (item.headerKind === 'folder' && item.folderId) {
                const header = { ...item, groupKey: folderKey(item.folderId) };
                if ((item.depth ?? 0) > 0 && currentFolder) {
                    currentFolder.items.push(header);
                } else {
                    currentFolder = { kind: 'folder', items: [header] };
                    blocks.push(currentFolder);
                }
                continue;
            }
            currentFolder = null;
            blocks.push({ kind: 'other', items: [item] });
            continue;
        }
        const keepsGroup = item.pinned === true || RETAINED_GROUP_KINDS.has(item.groupKind ?? '');
        const row: SessionListViewItem = keepsGroup ? item : {
            ...item,
            groupKey: item.folderId ? folderKey(item.folderId) : groupKey,
            groupKind: item.folderId ? 'folder' : 'flat',
            variant: 'default',
        };
        if (item.folderId && currentFolder) {
            currentFolder.items.push(row);
        } else {
            currentFolder = null;
            blocks.push({ kind: 'session', items: [row] });
        }
    }
    const foldersFirst = input.orderingMode !== 'custom' || input.folderSortMode !== 'mixed';
    const orderedBlocks = foldersFirst
        ? [...blocks.filter(block => block.kind === 'folder'), ...blocks.filter(block => block.kind !== 'folder')]
        : blocks;
    const header = band && (band.headerKind === 'active' || band.headerKind === 'inactive' || band.headerKind === 'sessions')
        ? { ...band, groupKey }
        : band;
    return [...(header ? [header] : []), ...orderedBlocks.flatMap(block => block.items)];
}

/** Presentation only: remove derived groups while retaining each row's physical Home and workspace. */
export function projectSessionListFlatView(input: ProjectSessionListFlatViewInput): SessionListViewItem[] {
    const output: SessionListViewItem[] = [];
    let band: Header | null = null;
    let entries: SessionListViewItem[] = [];
    const flush = () => {
        output.push(...projectBand(entries, band, input));
        entries = [];
    };
    for (const item of input.items) {
        if (item.type === 'header' && BANDS.has(item.headerKind ?? '')) {
            flush();
            band = item;
        } else {
            entries.push(item);
        }
    }
    flush();

    const index = output.map(buildSessionListIndexItemFromViewItem);
    const originals = new Map(index.map((item, position) => [item, output[position]]));
    const sessions = new Map(output.flatMap(item => item.type === 'session'
        ? [[`${item.serverId ?? ''}:${item.session.id}`, item.session] as const] : []));
    const ordered = input.orderingMode === 'custom'
        ? applySessionListIndexGroupOrdering(index, input.groupOrder ?? {}, { folderSortMode: input.folderSortMode, sectionMode: input.sectionMode })
        : sortSessionListIndexItemsByOrderingMode(index, input.orderingMode ?? 'custom',
            (serverId, sessionId) => sessions.get(`${serverId ?? ''}:${sessionId}`) ?? null, { sectionMode: input.sectionMode });
    return ordered.map(item => originals.get(item)!);
}
